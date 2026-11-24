import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type RemoteAction, validateRemoteAction } from "./validation.ts";

export interface ReceiverIdentity {
  receiverId: string;
  secretHash: Buffer;
  deviceName: string;
  online: boolean;
  lastSeenAt: number;
  lastSnapshot: unknown | null;
}

export interface PhoneIdentity {
  phoneId: string;
  secretHash: Buffer;
  phoneName: string;
  online: boolean;
  lastSeenAt: number;
}

export type PinState =
  | "open"
  | "pending_confirmation"
  | "consumed"
  | "invalidated";

export interface PairingPinRecord {
  pin: string;
  receiverId: string;
  createdAt: number;
  expiresAt: number;
  state: PinState;
  pendingPhoneId: string | null;
  failedAttempts: number;
}

export type SessionStatus =
  | "pending"
  | "active"
  | "denied"
  | "expired"
  | "revoked";

export interface SessionRecord {
  sessionId: string;
  phoneId: string;
  receiverId: string;
  status: SessionStatus;
  createdAt: number;
  requestExpiresAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

export interface RelayConfig {
  pinTtlMs?: number;
  sessionRequestTtlMs?: number;
  sessionTtlMs?: number;
  maxPinAttemptsPerWindow?: number;
  pinAttemptWindowMs?: number;
  maxCommandsPerWindow?: number;
  commandWindowMs?: number;
  stateFilePath?: string;
  now?: () => number;
}

export interface CommandCacheEntry {
  ok: boolean;
  error?: string;
  errorCode?: string;
  snapshot?: unknown;
}

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function isValidId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length >= 8 &&
    id.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(id)
  );
}

function isValidSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.length >= 16 && secret.length <= 256;
}

function sanitizeDisplayName(name: unknown, fallback: string): string {
  if (typeof name !== "string") return fallback;
  const trimmed = name.trim().slice(0, 48);
  return trimmed || fallback;
}

export class RelayCore {
  private readonly pinTtlMs: number;
  private readonly sessionRequestTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly maxPinAttemptsPerWindow: number;
  private readonly pinAttemptWindowMs: number;
  private readonly maxCommandsPerWindow: number;
  private readonly commandWindowMs: number;
  private readonly stateFilePath?: string;
  private readonly now: () => number;

  private readonly receivers = new Map<string, ReceiverIdentity>();
  private readonly phones = new Map<string, PhoneIdentity>();
  private readonly pins = new Map<string, PairingPinRecord>();
  // receiverId -> Set<phoneId>
  private readonly receiverPairings = new Map<string, Set<string>>();
  // sessionId -> SessionRecord
  private readonly sessions = new Map<string, SessionRecord>();
  // `${sessionId}:${commandId}` -> CommandCacheEntry
  private readonly commandCache = new Map<string, CommandCacheEntry>();
  // rateKey -> timestamps[]
  private readonly pinAttempts = new Map<string, number[]>();
  private readonly commandAttempts = new Map<string, number[]>();
  private readonly searchAttempts = new Map<string, number[]>();

  constructor(config: RelayConfig = {}) {
    this.pinTtlMs = config.pinTtlMs ?? 120_000;
    this.sessionRequestTtlMs = config.sessionRequestTtlMs ?? 60_000;
    this.sessionTtlMs = config.sessionTtlMs ?? 30 * 60_000;
    this.maxPinAttemptsPerWindow = config.maxPinAttemptsPerWindow ?? 5;
    this.pinAttemptWindowMs = config.pinAttemptWindowMs ?? 60_000;
    this.maxCommandsPerWindow = config.maxCommandsPerWindow ?? 30;
    this.commandWindowMs = config.commandWindowMs ?? 10_000;
    this.stateFilePath = config.stateFilePath;
    this.now = config.now ?? (() => Date.now());
    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    if (!this.stateFilePath || !existsSync(this.stateFilePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFilePath, "utf8")) as {
        receivers?: Array<{
          receiverId: string;
          secretHashHex: string;
          deviceName: string;
          lastSeenAt: number;
        }>;
        phones?: Array<{
          phoneId: string;
          secretHashHex: string;
          phoneName: string;
          lastSeenAt: number;
        }>;
        pairings?: Array<{ receiverId: string; phoneIds: string[] }>;
      };

      for (const r of raw.receivers ?? []) {
        this.receivers.set(r.receiverId, {
          receiverId: r.receiverId,
          secretHash: Buffer.from(r.secretHashHex, "hex"),
          deviceName: r.deviceName,
          online: false,
          lastSeenAt: r.lastSeenAt,
          lastSnapshot: null,
        });
      }
      for (const p of raw.phones ?? []) {
        this.phones.set(p.phoneId, {
          phoneId: p.phoneId,
          secretHash: Buffer.from(p.secretHashHex, "hex"),
          phoneName: p.phoneName,
          online: false,
          lastSeenAt: p.lastSeenAt,
        });
      }
      for (const pair of raw.pairings ?? []) {
        this.receiverPairings.set(pair.receiverId, new Set(pair.phoneIds));
      }
    } catch {
      // Ignore corrupt state file and start clean
    }
  }

  private savePersistedState(): void {
    if (!this.stateFilePath) return;
    try {
      mkdirSync(dirname(this.stateFilePath), { recursive: true });
      const payload = {
        receivers: Array.from(this.receivers.values()).map((r) => ({
          receiverId: r.receiverId,
          secretHashHex: r.secretHash.toString("hex"),
          deviceName: r.deviceName,
          lastSeenAt: r.lastSeenAt,
        })),
        phones: Array.from(this.phones.values()).map((p) => ({
          phoneId: p.phoneId,
          secretHashHex: p.secretHash.toString("hex"),
          phoneName: p.phoneName,
          lastSeenAt: p.lastSeenAt,
        })),
        pairings: Array.from(this.receiverPairings.entries()).map(
          ([receiverId, set]) => ({
            receiverId,
            phoneIds: Array.from(set),
          }),
        ),
      };
      writeFileSync(this.stateFilePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      // Best-effort persistence
    }
  }

  private checkSlidingWindow(
    store: Map<string, number[]>,
    key: string,
    max: number,
    windowMs: number,
  ): boolean {
    const t = this.now();
    const list = (store.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (list.length >= max) {
      store.set(key, list);
      return false;
    }
    list.push(t);
    store.set(key, list);
    return true;
  }

  private refreshSessionExpiry(session: SessionRecord): SessionRecord {
    const t = this.now();
    if (session.revoked) {
      session.status = "revoked";
      return session;
    }
    if (session.status === "pending" && t > session.requestExpiresAt) {
      session.status = "expired";
    } else if (
      session.status === "active" &&
      session.expiresAt !== null &&
      t >= session.expiresAt
    ) {
      session.status = "expired";
    }
    return session;
  }

  authenticateReceiver(
    receiverId: unknown,
    secret: unknown,
    deviceName?: unknown,
  ):
    | { ok: true; receiver: ReceiverIdentity }
    | { ok: false; error: string; errorCode: string } {
    if (!isValidId(receiverId) || !isValidSecret(secret)) {
      return {
        ok: false,
        error: "Invalid receiver credentials.",
        errorCode: "INVALID_CREDENTIALS",
      };
    }

    const secretHash = hashSecret(secret);
    const existing = this.receivers.get(receiverId);
    const t = this.now();

    if (existing) {
      if (!timingSafeEqual(existing.secretHash, secretHash)) {
        return {
          ok: false,
          error: "Receiver authentication failed.",
          errorCode: "AUTH_FAILED",
        };
      }
      existing.online = true;
      existing.lastSeenAt = t;
      if (deviceName !== undefined) {
        existing.deviceName = sanitizeDisplayName(deviceName, existing.deviceName);
      }
      return { ok: true, receiver: existing };
    }

    const created: ReceiverIdentity = {
      receiverId,
      secretHash,
      deviceName: sanitizeDisplayName(deviceName, "Desktop Browser"),
      online: true,
      lastSeenAt: t,
      lastSnapshot: null,
    };
    this.receivers.set(receiverId, created);
    this.savePersistedState();
    return { ok: true, receiver: created };
  }

  authenticatePhone(
    phoneId: unknown,
    secret: unknown,
    phoneName?: unknown,
  ):
    | { ok: true; phone: PhoneIdentity }
    | { ok: false; error: string; errorCode: string } {
    if (!isValidId(phoneId) || !isValidSecret(secret)) {
      return {
        ok: false,
        error: "Invalid phone credentials.",
        errorCode: "INVALID_CREDENTIALS",
      };
    }

    const secretHash = hashSecret(secret);
    const existing = this.phones.get(phoneId);
    const t = this.now();

    if (existing) {
      if (!timingSafeEqual(existing.secretHash, secretHash)) {
        return {
          ok: false,
          error: "Phone authentication failed.",
          errorCode: "AUTH_FAILED",
        };
      }
      existing.online = true;
      existing.lastSeenAt = t;
      if (phoneName !== undefined) {
        existing.phoneName = sanitizeDisplayName(phoneName, existing.phoneName);
      }
      return { ok: true, phone: existing };
    }

    const created: PhoneIdentity = {
      phoneId,
      secretHash,
      phoneName: sanitizeDisplayName(phoneName, "Phone"),
      online: true,
      lastSeenAt: t,
    };
    this.phones.set(phoneId, created);
    this.savePersistedState();
    return { ok: true, phone: created };
  }

  setReceiverOffline(receiverId: string): void {
    const rec = this.receivers.get(receiverId);
    if (rec) {
      rec.online = false;
      rec.lastSeenAt = this.now();
    }
  }

  setPhoneOffline(phoneId: string): void {
    const phone = this.phones.get(phoneId);
    if (phone) {
      phone.online = false;
      phone.lastSeenAt = this.now();
    }
  }

  updateReceiverSnapshot(receiverId: string, snapshot: unknown): void {
    const rec = this.receivers.get(receiverId);
    if (rec) {
      rec.lastSnapshot = snapshot;
      rec.lastSeenAt = this.now();
    }
  }

  createPairingPin(
    receiverId: string,
  ):
    | { ok: true; pin: string; expiresAt: number }
    | { ok: false; error: string } {
    const rec = this.receivers.get(receiverId);
    if (!rec) {
      return { ok: false, error: "Receiver not authenticated." };
    }

    // Invalidate previous open/pending PINs for this receiver
    for (const record of this.pins.values()) {
      if (
        record.receiverId === receiverId &&
        (record.state === "open" || record.state === "pending_confirmation")
      ) {
        record.state = "invalidated";
      }
    }

    let pin = "";
    for (let i = 0; i < 10; i++) {
      const candidate = String(randomInt(100000, 1000000));
      const existing = this.pins.get(candidate);
      if (
        !existing ||
        existing.state === "consumed" ||
        existing.state === "invalidated" ||
        existing.expiresAt <= this.now()
      ) {
        pin = candidate;
        break;
      }
    }

    if (!pin) {
      return { ok: false, error: "Could not allocate a unique pairing PIN." };
    }

    const t = this.now();
    this.pins.set(pin, {
      pin,
      receiverId,
      createdAt: t,
      expiresAt: t + this.pinTtlMs,
      state: "open",
      pendingPhoneId: null,
      failedAttempts: 0,
    });

    return { ok: true, pin, expiresAt: t + this.pinTtlMs };
  }

  submitPairingPin(
    phoneId: string,
    rawPin: unknown,
    rateKey: string = phoneId,
  ):
    | {
        ok: true;
        receiverId: string;
        deviceName: string;
        phoneId: string;
        phoneName: string;
        expiresAt: number;
      }
    | { ok: false; error: string; errorCode: string } {
    const phone = this.phones.get(phoneId);
    if (!phone) {
      return {
        ok: false,
        error: "Phone not authenticated.",
        errorCode: "AUTH_REQUIRED",
      };
    }

    if (
      !this.checkSlidingWindow(
        this.pinAttempts,
        rateKey,
        this.maxPinAttemptsPerWindow,
        this.pinAttemptWindowMs,
      )
    ) {
      return {
        ok: false,
        error: "Too many pairing attempts. Wait a minute before trying again.",
        errorCode: "RATE_LIMITED",
      };
    }

    const pin = typeof rawPin === "string" ? rawPin.replace(/\s+/g, "") : "";
    if (!/^\d{6}$/.test(pin)) {
      return {
        ok: false,
        error: "Enter a valid six-digit pairing PIN.",
        errorCode: "INVALID_PIN_FORMAT",
      };
    }

    const record = this.pins.get(pin);
    if (!record) {
      return {
        ok: false,
        error: "Incorrect pairing PIN. Check the code on your desktop.",
        errorCode: "WRONG_PIN",
      };
    }

    const t = this.now();
    if (record.expiresAt <= t) {
      record.state = "invalidated";
      return {
        ok: false,
        error: "This pairing PIN has expired. Generate a new one on your desktop.",
        errorCode: "PIN_EXPIRED",
      };
    }

    if (record.state !== "open") {
      return {
        ok: false,
        error: "This pairing PIN has already been used.",
        errorCode: "PIN_USED",
      };
    }

    const receiver = this.receivers.get(record.receiverId);
    if (!receiver || !receiver.online) {
      return {
        ok: false,
        error: "The desktop receiver is offline.",
        errorCode: "RECEIVER_OFFLINE",
      };
    }

    record.state = "pending_confirmation";
    record.pendingPhoneId = phoneId;

    return {
      ok: true,
      receiverId: receiver.receiverId,
      deviceName: receiver.deviceName,
      phoneId: phone.phoneId,
      phoneName: phone.phoneName,
      expiresAt: record.expiresAt,
    };
  }

  confirmPairing(
    receiverId: string,
    phoneId: string,
    approve: boolean,
  ):
    | {
        ok: true;
        approved: boolean;
        receiverId: string;
        deviceName: string;
        phoneId: string;
        phoneName: string;
      }
    | { ok: false; error: string; errorCode: string } {
    const receiver = this.receivers.get(receiverId);
    if (!receiver) {
      return {
        ok: false,
        error: "Receiver not authenticated.",
        errorCode: "AUTH_REQUIRED",
      };
    }

    let targetPin: PairingPinRecord | null = null;
    for (const record of this.pins.values()) {
      if (
        record.receiverId === receiverId &&
        record.state === "pending_confirmation" &&
        record.pendingPhoneId === phoneId
      ) {
        targetPin = record;
        break;
      }
    }

    if (!targetPin) {
      return {
        ok: false,
        error: "No pending pairing request for this phone.",
        errorCode: "NO_PENDING_PAIRING",
      };
    }

    if (targetPin.expiresAt <= this.now()) {
      targetPin.state = "invalidated";
      return {
        ok: false,
        error: "The pairing PIN expired before confirmation.",
        errorCode: "PIN_EXPIRED",
      };
    }

    const phone = this.phones.get(phoneId);
    if (!phone) {
      targetPin.state = "invalidated";
      return {
        ok: false,
        error: "Phone identity no longer exists.",
        errorCode: "PHONE_NOT_FOUND",
      };
    }

    if (!approve) {
      targetPin.state = "invalidated";
      return {
        ok: true,
        approved: false,
        receiverId,
        deviceName: receiver.deviceName,
        phoneId,
        phoneName: phone.phoneName,
      };
    }

    targetPin.state = "consumed";
    let set = this.receiverPairings.get(receiverId);
    if (!set) {
      set = new Set<string>();
      this.receiverPairings.set(receiverId, set);
    }
    set.add(phoneId);
    this.savePersistedState();

    return {
      ok: true,
      approved: true,
      receiverId,
      deviceName: receiver.deviceName,
      phoneId,
      phoneName: phone.phoneName,
    };
  }

  isPaired(phoneId: string, receiverId: string): boolean {
    return this.receiverPairings.get(receiverId)?.has(phoneId) ?? false;
  }

  revokePairing(receiverId: string, phoneId: string): SessionRecord[] {
    this.receiverPairings.get(receiverId)?.delete(phoneId);
    this.savePersistedState();
    const revokedSessions: SessionRecord[] = [];
    for (const session of this.sessions.values()) {
      if (
        session.receiverId === receiverId &&
        session.phoneId === phoneId &&
        (session.status === "active" || session.status === "pending")
      ) {
        session.revoked = true;
        session.status = "revoked";
        revokedSessions.push(session);
      }
    }
    return revokedSessions;
  }

  requestSession(
    phoneId: string,
    receiverId: string,
  ):
    | { ok: true; session: SessionRecord; phoneName: string; deviceName: string }
    | { ok: false; error: string; errorCode: string } {
    const phone = this.phones.get(phoneId);
    if (!phone) {
      return {
        ok: false,
        error: "Phone not authenticated.",
        errorCode: "AUTH_REQUIRED",
      };
    }
    const receiver = this.receivers.get(receiverId);
    if (!this.isPaired(phoneId, receiverId)) {
      return {
        ok: false,
        error: "This phone is not paired with the selected desktop.",
        errorCode: "NOT_PAIRED",
      };
    }
    if (!receiver || !receiver.online) {
      return {
        ok: false,
        error: "Desktop receiver is offline. Open Chrome/Dia on desktop first.",
        errorCode: "RECEIVER_OFFLINE",
      };
    }

    // Supersede any existing pending/active session for this (phoneId, receiverId)
    for (const existing of this.sessions.values()) {
      if (
        existing.phoneId === phoneId &&
        existing.receiverId === receiverId &&
        (existing.status === "pending" || existing.status === "active")
      ) {
        existing.revoked = true;
        existing.status = "revoked";
      }
    }

    const t = this.now();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      phoneId,
      receiverId,
      status: "pending",
      createdAt: t,
      requestExpiresAt: t + this.sessionRequestTtlMs,
      expiresAt: null,
      revoked: false,
    };
    this.sessions.set(session.sessionId, session);

    return {
      ok: true,
      session,
      phoneName: phone.phoneName,
      deviceName: receiver.deviceName,
    };
  }

  respondToSession(
    receiverId: string,
    sessionId: string,
    approve: boolean,
  ):
    | { ok: true; session: SessionRecord }
    | { ok: false; error: string; errorCode: string } {
    const session = this.sessions.get(sessionId);
    if (!session || session.receiverId !== receiverId) {
      return {
        ok: false,
        error: "Control request not found.",
        errorCode: "SESSION_NOT_FOUND",
      };
    }

    this.refreshSessionExpiry(session);
    if (session.status !== "pending") {
      return {
        ok: false,
        error:
          session.status === "expired"
            ? "Control request expired before approval."
            : "Control request is no longer pending.",
        errorCode:
          session.status === "expired" ? "SESSION_EXPIRED" : "INVALID_STATE",
      };
    }

    if (!this.isPaired(session.phoneId, receiverId)) {
      session.revoked = true;
      session.status = "revoked";
      return {
        ok: false,
        error: "Phone pairing was revoked.",
        errorCode: "NOT_PAIRED",
      };
    }

    if (approve) {
      session.status = "active";
      session.expiresAt = this.now() + this.sessionTtlMs;
    } else {
      session.status = "denied";
    }

    return { ok: true, session };
  }

  revokeSession(
    receiverId: string,
    sessionId: string,
  ):
    | { ok: true; session: SessionRecord }
    | { ok: false; error: string } {
    const session = this.sessions.get(sessionId);
    if (!session || session.receiverId !== receiverId) {
      return { ok: false, error: "Session not found." };
    }
    session.revoked = true;
    session.status = "revoked";
    return { ok: true, session };
  }

  endSessionByPhone(
    phoneId: string,
    sessionId: string,
  ):
    | { ok: true; session: SessionRecord }
    | { ok: false; error: string } {
    const session = this.sessions.get(sessionId);
    if (!session || session.phoneId !== phoneId) {
      return { ok: false, error: "Session not found." };
    }
    session.revoked = true;
    session.status = "revoked";
    return { ok: true, session };
  }

  authorizeCommand(
    phoneId: string,
    receiverId: string,
    sessionId: unknown,
    commandId: unknown,
    rawAction: unknown,
  ):
    | {
        ok: true;
        session: SessionRecord;
        action: RemoteAction;
        commandId: string;
        duplicate: boolean;
        cachedResult?: CommandCacheEntry;
      }
    | { ok: false; error: string; errorCode: string } {
    if (
      !this.checkSlidingWindow(
        this.commandAttempts,
        phoneId,
        this.maxCommandsPerWindow,
        this.commandWindowMs,
      )
    ) {
      return {
        ok: false,
        error: "Too many commands sent too quickly.",
        errorCode: "RATE_LIMITED",
      };
    }

    if (typeof sessionId !== "string" || typeof commandId !== "string" || !commandId) {
      return {
        ok: false,
        error: "Missing session or command identifier.",
        errorCode: "INVALID_REQUEST",
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session || session.phoneId !== phoneId || session.receiverId !== receiverId) {
      return {
        ok: false,
        error: "Session is not authorized for this phone and desktop.",
        errorCode: "UNAUTHORIZED_SESSION",
      };
    }

    if (!this.isPaired(phoneId, receiverId)) {
      session.revoked = true;
      session.status = "revoked";
      return {
        ok: false,
        error: "Pairing was revoked. Pair again to control this desktop.",
        errorCode: "NOT_PAIRED",
      };
    }

    this.refreshSessionExpiry(session);

    if (session.status === "pending") {
      return {
        ok: false,
        error: "Desktop approval is still pending.",
        errorCode: "APPROVAL_PENDING",
      };
    }
    if (session.status === "denied") {
      return {
        ok: false,
        error: "Control request was denied by the desktop.",
        errorCode: "SESSION_DENIED",
      };
    }
    if (session.status === "revoked") {
      return {
        ok: false,
        error: "Phone access was ended. Request a new session on the desktop.",
        errorCode: "SESSION_REVOKED",
      };
    }
    if (session.status === "expired") {
      return {
        ok: false,
        error: "Control session expired. Request fresh approval.",
        errorCode: "SESSION_EXPIRED",
      };
    }

    const receiver = this.receivers.get(receiverId);
    if (!receiver || !receiver.online) {
      return {
        ok: false,
        error: "Desktop receiver is offline.",
        errorCode: "RECEIVER_OFFLINE",
      };
    }

    const validatedAction = validateRemoteAction(rawAction);
    if (!validatedAction.ok) {
      return {
        ok: false,
        error: validatedAction.error,
        errorCode: "INVALID_COMMAND",
      };
    }

    const cacheKey = `${sessionId}:${commandId}`;
    const cached = this.commandCache.get(cacheKey);
    if (cached) {
      return {
        ok: true,
        session,
        action: validatedAction.action,
        commandId,
        duplicate: true,
        cachedResult: cached,
      };
    }

    return {
      ok: true,
      session,
      action: validatedAction.action,
      commandId,
      duplicate: false,
    };
  }

  recordCommandResult(
    sessionId: string,
    commandId: string,
    result: CommandCacheEntry,
  ): void {
    this.commandCache.set(`${sessionId}:${commandId}`, result);
  }

  checkSearchRateLimit(phoneId: string): boolean {
    if (!this.phones.has(phoneId)) return false;
    return this.checkSlidingWindow(this.searchAttempts, phoneId, 15, 60_000);
  }

  getReceiverSnapshotForPhone(phoneId: string, receiverId: string): unknown | null {
    if (!this.isPaired(phoneId, receiverId)) return null;
    for (const session of this.sessions.values()) {
      this.refreshSessionExpiry(session);
      if (
        session.phoneId === phoneId &&
        session.receiverId === receiverId &&
        session.status === "active"
      ) {
        return this.receivers.get(receiverId)?.lastSnapshot ?? null;
      }
    }
    return null;
  }

  getReceiverStateSnapshot(receiverId: string) {
    const pairedPhoneIds = Array.from(this.receiverPairings.get(receiverId) ?? []);
    const pairedPhones = pairedPhoneIds
      .map((id) => this.phones.get(id))
      .filter((p): p is PhoneIdentity => Boolean(p))
      .map((p) => ({
        phoneId: p.phoneId,
        phoneName: p.phoneName,
        online: p.online,
      }));

    let activeSession: (SessionRecord & { phoneName: string }) | null = null;
    let pendingSession: (SessionRecord & { phoneName: string }) | null = null;

    for (const session of this.sessions.values()) {
      if (session.receiverId !== receiverId) continue;
      this.refreshSessionExpiry(session);
      const phoneName = this.phones.get(session.phoneId)?.phoneName ?? "Phone";
      if (session.status === "active") {
        activeSession = { ...session, phoneName };
      } else if (session.status === "pending") {
        pendingSession = { ...session, phoneName };
      }
    }

    return {
      receiverId,
      deviceName: this.receivers.get(receiverId)?.deviceName ?? "Desktop Browser",
      pairedPhones,
      activeSession,
      pendingSession,
    };
  }

  getPhoneStateSnapshot(phoneId: string) {
    const pairedReceivers: Array<{
      receiverId: string;
      deviceName: string;
      online: boolean;
      session: SessionRecord | null;
      playerSnapshot: unknown | null;
    }> = [];

    for (const [receiverId, phoneSet] of this.receiverPairings.entries()) {
      if (!phoneSet.has(phoneId)) continue;
      const receiver = this.receivers.get(receiverId);
      if (!receiver) continue;

      let latestSession: SessionRecord | null = null;
      for (const session of this.sessions.values()) {
        if (session.phoneId !== phoneId || session.receiverId !== receiverId) {
          continue;
        }
        this.refreshSessionExpiry(session);
        if (!latestSession || session.createdAt >= latestSession.createdAt) {
          latestSession = { ...session };
        }
      }

      pairedReceivers.push({
        receiverId,
        deviceName: receiver.deviceName,
        online: receiver.online,
        session: latestSession,
        playerSnapshot:
          latestSession?.status === "active" ? receiver.lastSnapshot : null,
      });
    }

    return {
      phoneId,
      phoneName: this.phones.get(phoneId)?.phoneName ?? "Phone",
      pairedReceivers,
    };
  }
}
