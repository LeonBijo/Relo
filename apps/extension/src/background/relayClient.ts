import {
  type BackgroundToPopupEvent,
  type CommandResult,
  type PairedPhoneInfo,
  type PendingPairingRequest,
  type PlayerSnapshot,
  type ReceiverState,
  type RelayUiState,
  type RemoteSessionInfo,
  validatePlaybackCommand,
} from "../shared/protocol.ts";
import { validateYouTubeVideoUrl } from "../shared/youtubeUrl.ts";
import {
  closeDesignatedTab,
  designateYouTubeTab,
  executeReceiverCommand,
  focusDesignatedTab,
  getReceiverState,
  playVideoUrl,
} from "./receiverService.ts";

const RELAY_STORAGE_KEY = "reloRelayConfig";
const KEEPALIVE_ALARM = "relo-relay-keepalive";
const DEFAULT_RELAY_URL = "ws://localhost:8787/ws";

interface StoredRelayConfig {
  receiverId: string;
  receiverSecret: string;
  deviceName: string;
  relayUrl: string;
  approvedSession: RemoteSessionInfo | null;
  favoritePhoneId: string | null;
}

function generateRandomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidRelayUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

let configCache: StoredRelayConfig | null = null;
let socket: WebSocket | null = null;
let connectPromise: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let uiState: RelayUiState = {
  connectionStatus: "offline",
  relayUrl: DEFAULT_RELAY_URL,
  receiverId: "",
  deviceName: "My Desktop",
  activePin: null,
  pinExpiresAt: null,
  pendingPairing: null,
  pairedPhones: [],
  favoritePhoneId: null,
  pendingSession: null,
  activeSession: null,
  lastSessionOutcome: null,
  lastRelayError: null,
  phoneAppUrl: null,
};

function notifyPopup() {
  const event: BackgroundToPopupEvent = {
    type: "RELAY_STATE_UPDATED",
    relayState: { ...uiState },
  };
  chrome.runtime.sendMessage(event).catch(() => {
    // Popup closed; ignore.
  });
}

async function loadConfig(): Promise<StoredRelayConfig> {
  if (configCache) return configCache;
  const stored = await chrome.storage.local.get(RELAY_STORAGE_KEY);
  const raw = stored[RELAY_STORAGE_KEY] as Partial<StoredRelayConfig> | undefined;

  const receiverId =
    typeof raw?.receiverId === "string" && raw.receiverId.length >= 8
      ? raw.receiverId
      : `rx-${generateRandomHex(12)}`;
  const receiverSecret =
    typeof raw?.receiverSecret === "string" && raw.receiverSecret.length >= 16
      ? raw.receiverSecret
      : generateRandomHex(32);
  const deviceName =
    typeof raw?.deviceName === "string" && raw.deviceName.trim()
      ? raw.deviceName.trim().slice(0, 48)
      : "My Desktop";
  const relayUrl =
    typeof raw?.relayUrl === "string" && isValidRelayUrl(raw.relayUrl)
      ? raw.relayUrl.trim()
      : DEFAULT_RELAY_URL;
  const approvedSession = raw?.approvedSession ?? null;
  const favoritePhoneId =
    typeof raw?.favoritePhoneId === "string" ? raw.favoritePhoneId : null;

  configCache = {
    receiverId,
    receiverSecret,
    deviceName,
    relayUrl,
    approvedSession,
    favoritePhoneId,
  };

  if (
    !raw?.receiverId ||
    !raw?.receiverSecret ||
    raw.relayUrl !== relayUrl ||
    raw.deviceName !== deviceName
  ) {
    await chrome.storage.local.set({ [RELAY_STORAGE_KEY]: configCache });
  }

  uiState.receiverId = receiverId;
  uiState.deviceName = deviceName;
  uiState.relayUrl = relayUrl;
  uiState.activeSession = approvedSession;
  uiState.favoritePhoneId = favoritePhoneId;

  return configCache;
}

async function saveConfig(patch: Partial<StoredRelayConfig>): Promise<StoredRelayConfig> {
  const current = await loadConfig();
  configCache = { ...current, ...patch };
  await chrome.storage.local.set({ [RELAY_STORAGE_KEY]: configCache });
  return configCache;
}

function sendWs(payload: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureRelayConnected();
  }, 3000);
  if (
    typeof reconnectTimer === "object" &&
    reconnectTimer !== null &&
    "unref" in reconnectTimer
  ) {
    (reconnectTimer as { unref: () => void }).unref();
  }
}

/**
 * Receiver-side authorization check before executing any remote phone command.
 */
export async function isRemoteSessionAuthorized(
  sessionId: string,
  phoneId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await loadConfig();
  const approved = cfg.approvedSession;
  if (!approved) {
    return { ok: false, error: "No approved remote session on this desktop." };
  }
  if (approved.revoked || approved.status !== "active") {
    return { ok: false, error: "Remote session has been ended or revoked." };
  }
  if (approved.sessionId !== sessionId || approved.phoneId !== phoneId) {
    return { ok: false, error: "Session does not match the approved phone." };
  }
  if (approved.expiresAt !== null && Date.now() >= approved.expiresAt) {
    await saveConfig({ approvedSession: null });
    uiState.activeSession = null;
    uiState.lastSessionOutcome = "expired";
    notifyPopup();
    return { ok: false, error: "Approved session has expired." };
  }
  return { ok: true };
}

async function handleExecuteRemoteCommand(msg: {
  sessionId: string;
  phoneId: string;
  commandId: string;
  action: unknown;
}) {
  const auth = await isRemoteSessionAuthorized(msg.sessionId, msg.phoneId);
  if (!auth.ok) {
    sendWs({
      type: "COMMAND_RESULT",
      commandId: msg.commandId,
      ok: false,
      errorCode: "UNAUTHORIZED",
      error: auth.error,
    });
    return;
  }

  const action = msg.action as Record<string, unknown> | null;
  if (!action || typeof action !== "object") {
    sendWs({
      type: "COMMAND_RESULT",
      commandId: msg.commandId,
      ok: false,
      errorCode: "INVALID_COMMAND",
      error: "Invalid remote action.",
    });
    return;
  }

  let result: CommandResult;
  if (action.type === "PLAY_VIDEO_URL") {
    const urlCheck = validateYouTubeVideoUrl(String(action.url ?? ""));
    if (!urlCheck.ok) {
      sendWs({
        type: "COMMAND_RESULT",
        commandId: msg.commandId,
        ok: false,
        errorCode: "INVALID_URL",
        error: urlCheck.error,
      });
      return;
    }
    result = await playVideoUrl(urlCheck.canonicalUrl);
  } else if (action.type === "PLAYER_COMMAND") {
    const cmdCheck = validatePlaybackCommand(action.command);
    if (!cmdCheck.ok) {
      sendWs({
        type: "COMMAND_RESULT",
        commandId: msg.commandId,
        ok: false,
        errorCode: "INVALID_COMMAND",
        error: cmdCheck.error,
      });
      return;
    }
    result = await executeReceiverCommand(cmdCheck.command);
  } else if (action.type === "DESIGNATE_TAB") {
    const tabId = action.tabId;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) {
      sendWs({
        type: "COMMAND_RESULT",
        commandId: msg.commandId,
        ok: false,
        errorCode: "INVALID_COMMAND",
        error: "Tab ID must be a non-negative integer.",
      });
      return;
    }
    result = await designateYouTubeTab(tabId);
  } else if (action.type === "FOCUS_TAB") {
    result = await focusDesignatedTab();
  } else if (action.type === "CLOSE_TAB") {
    result = await closeDesignatedTab();
  } else if (action.type === "REFRESH_STATE") {
    const state = await getReceiverState();
    result = { ok: true, state, snapshot: state.player ?? undefined };
  } else {
    sendWs({
      type: "COMMAND_RESULT",
      commandId: msg.commandId,
      ok: false,
      errorCode: "UNSUPPORTED_ACTION",
      error: "Unsupported remote action.",
    });
    return;
  }

  const rxState = result.state ?? (await getReceiverState());
  const snapshot = buildRemoteSnapshot(rxState, result.snapshot);
  pushReceiverStateToRelay(rxState);

  sendWs({
    type: "COMMAND_RESULT",
    commandId: msg.commandId,
    ok: result.ok,
    error: result.error,
    errorCode: result.errorCode,
    snapshot,
  });

  // Also broadcast fresh receiver state to popup if open
  if (result.state) {
    chrome.runtime
      .sendMessage({ type: "RECEIVER_STATE_UPDATED", state: result.state })
      .catch(() => {});
  }
}

function applyServerReceiverState(serverState: {
  deviceName?: string;
  pairedPhones?: PairedPhoneInfo[];
  activeSession?: RemoteSessionInfo | null;
  pendingSession?: RemoteSessionInfo | null;
  phoneAppUrl?: string | null;
}) {
  if (serverState.deviceName) {
    uiState.deviceName = serverState.deviceName;
  }
  if (serverState.phoneAppUrl !== undefined) {
    uiState.phoneAppUrl = serverState.phoneAppUrl;
  }
  uiState.pairedPhones = serverState.pairedPhones ?? [];
  uiState.activeSession = serverState.activeSession ?? null;
  uiState.pendingSession = serverState.pendingSession ?? null;
  if (uiState.activeSession) {
    uiState.lastSessionOutcome = null;
    void getReceiverState().then(pushReceiverStateToRelay);
  }
  void saveConfig({ approvedSession: uiState.activeSession });
  notifyPopup();
}

export async function ensureRelayConnected(
  forceReconnect = false,
): Promise<void> {
  const cfg = await loadConfig();

  if (forceReconnect) {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      const oldSocket = socket;
      socket = null;
      try {
        oldSocket.close();
      } catch {
        // Ignore close error on stale socket
      }
    }
    connectPromise = null;
  }

  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (connectPromise) return connectPromise;

  uiState.connectionStatus = "connecting";
  uiState.lastRelayError = null;
  notifyPopup();

  connectPromise = new Promise<void>((resolve) => {
    let settled = false;
    let connectTimeout: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (connectTimeout !== null) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      if (!settled) {
        settled = true;
        connectPromise = null;
        resolve();
      }
    };

    try {
      const ws = new WebSocket(cfg.relayUrl);
      socket = ws;

      connectTimeout = setTimeout(() => {
        if (socket !== ws || settled) return;
        uiState.connectionStatus = "offline";
        uiState.lastRelayError = `Connection timed out reaching ${cfg.relayUrl}.`;
        try {
          ws.close();
        } catch {
          // Ignore
        }
        if (socket === ws) socket = null;
        notifyPopup();
        scheduleReconnect();
        finish();
      }, 5000);

      ws.addEventListener("open", () => {
        if (socket !== ws) return;
        ws.send(
          JSON.stringify({
            type: "RECEIVER_AUTH",
            receiverId: cfg.receiverId,
            secret: cfg.receiverSecret,
            deviceName: cfg.deviceName,
          }),
        );
      });

      ws.addEventListener("message", (event) => {
        if (socket !== ws) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        switch (msg.type) {
          case "AUTH_OK": {
            uiState.connectionStatus = "online";
            uiState.lastRelayError = null;
            if (msg.state && typeof msg.state === "object") {
              applyServerReceiverState(
                msg.state as Parameters<typeof applyServerReceiverState>[0],
              );
            } else {
              notifyPopup();
            }
            // Push latest player + tab list snapshot upon reconnect
            void getReceiverState().then((rxState) => {
              pushReceiverStateToRelay(rxState);
            });
            finish();
            break;
          }

          case "AUTH_ERROR": {
            uiState.connectionStatus = "offline";
            uiState.lastRelayError =
              typeof msg.error === "string"
                ? msg.error
                : "Relay authentication failed.";
            notifyPopup();
            finish();
            break;
          }

          case "RECEIVER_STATE": {
            if (msg.state && typeof msg.state === "object") {
              applyServerReceiverState(
                msg.state as Parameters<typeof applyServerReceiverState>[0],
              );
            }
            break;
          }

          case "PAIRING_PIN_CREATED": {
            uiState.activePin = typeof msg.pin === "string" ? msg.pin : null;
            uiState.pinExpiresAt =
              typeof msg.expiresAt === "number" ? msg.expiresAt : null;
            uiState.pendingPairing = null;
            uiState.lastRelayError = null;
            notifyPopup();
            break;
          }

          case "PAIR_INCOMING": {
            const pending: PendingPairingRequest = {
              phoneId: String(msg.phoneId ?? ""),
              phoneName: String(msg.phoneName ?? "Phone"),
              expiresAt:
                typeof msg.expiresAt === "number"
                  ? msg.expiresAt
                  : Date.now() + 120_000,
            };
            uiState.pendingPairing = pending;
            notifyPopup();
            break;
          }

          case "SESSION_INCOMING": {
            if (msg.session && typeof msg.session === "object") {
              const session = msg.session as RemoteSessionInfo;
              uiState.pendingSession = {
                ...session,
                phoneName: String(msg.phoneName ?? session.phoneName ?? "Phone"),
              };
              uiState.lastSessionOutcome = null;
              notifyPopup();
            }
            break;
          }

          case "EXECUTE_REMOTE_COMMAND": {
            void handleExecuteRemoteCommand({
              sessionId: String(msg.sessionId ?? ""),
              phoneId: String(msg.phoneId ?? ""),
              commandId: String(msg.commandId ?? ""),
              action: msg.action,
            });
            break;
          }

          case "PAIR_CONFIRM_ERROR":
          case "SESSION_RESPOND_ERROR":
          case "PAIRING_PIN_ERROR":
          case "ERROR": {
            uiState.lastRelayError =
              typeof msg.error === "string" ? msg.error : "Relay error.";
            notifyPopup();
            break;
          }
        }
      });

      ws.addEventListener("close", () => {
        if (socket !== ws) {
          finish();
          return;
        }
        socket = null;
        uiState.connectionStatus = "offline";
        notifyPopup();
        scheduleReconnect();
        finish();
      });

      ws.addEventListener("error", () => {
        if (socket !== ws) {
          finish();
          return;
        }
        uiState.connectionStatus = "offline";
        uiState.lastRelayError = `Relay unreachable at ${cfg.relayUrl}.`;
        notifyPopup();
        finish();
      });
    } catch {
      uiState.connectionStatus = "offline";
      uiState.lastRelayError = `Invalid relay URL: ${cfg.relayUrl}`;
      notifyPopup();
      finish();
    }
  });

  return connectPromise;
}

export async function initRelayClient(): Promise<void> {
  await loadConfig();
  if (chrome.alarms) {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  }
  await ensureRelayConnected();
}

export async function handleRelayAlarm(alarmName: string): Promise<void> {
  if (alarmName !== KEEPALIVE_ALARM) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    await ensureRelayConnected();
  } else {
    sendWs({ type: "PING" });
  }
}

export async function getRelayUiState(): Promise<RelayUiState> {
  await loadConfig();
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    void ensureRelayConnected();
  }
  // Clear expired PIN locally for accurate UI
  if (uiState.pinExpiresAt && Date.now() >= uiState.pinExpiresAt) {
    uiState.activePin = null;
    uiState.pinExpiresAt = null;
    uiState.pendingPairing = null;
  }
  return { ...uiState };
}

export async function setRelayConfig(
  deviceName?: string,
  relayUrl?: string,
): Promise<CommandResult> {
  const cfg = await loadConfig();
  const nextName =
    deviceName !== undefined && deviceName.trim()
      ? deviceName.trim().slice(0, 48)
      : cfg.deviceName;
  let nextUrl = cfg.relayUrl;
  if (relayUrl !== undefined && relayUrl.trim()) {
    if (!isValidRelayUrl(relayUrl)) {
      return {
        ok: false,
        relayState: { ...uiState },
        error: "Relay URL must start with ws:// or wss://.",
      };
    }
    nextUrl = relayUrl.trim();
  }

  await saveConfig({ deviceName: nextName, relayUrl: nextUrl });
  uiState.deviceName = nextName;
  uiState.relayUrl = nextUrl;

  await ensureRelayConnected(true);
  if (uiState.connectionStatus !== "online") {
    return {
      ok: false,
      relayState: { ...uiState },
      error: uiState.lastRelayError ?? `Could not connect to ${nextUrl}.`,
    };
  }

  return { ok: true, relayState: { ...uiState } };
}

export async function createPairingPin(): Promise<CommandResult> {
  await ensureRelayConnected();
  if (!sendWs({ type: "CREATE_PAIRING_PIN" })) {
    return {
      ok: false,
      relayState: { ...uiState },
      error: "Relay is offline. Start the relay server and reconnect.",
    };
  }
  return { ok: true, relayState: { ...uiState } };
}

export async function confirmPairingRequest(
  phoneId: string,
  approve: boolean,
): Promise<CommandResult> {
  await ensureRelayConnected();
  if (!sendWs({ type: "PAIR_CONFIRM", phoneId, approve })) {
    return {
      ok: false,
      relayState: { ...uiState },
      error: "Relay is offline.",
    };
  }
  uiState.pendingPairing = null;
  uiState.activePin = null;
  uiState.pinExpiresAt = null;
  notifyPopup();
  return { ok: true, relayState: { ...uiState } };
}

export async function respondToSessionRequest(
  sessionId: string,
  approve: boolean,
): Promise<CommandResult> {
  await ensureRelayConnected();
  if (!sendWs({ type: "SESSION_RESPOND", sessionId, approve })) {
    return {
      ok: false,
      relayState: { ...uiState },
      error: "Relay is offline.",
    };
  }
  if (!approve) {
    uiState.pendingSession = null;
    uiState.lastSessionOutcome = "denied";
  }
  notifyPopup();
  return { ok: true, relayState: { ...uiState } };
}

export async function revokeActiveSession(
  sessionId: string,
): Promise<CommandResult> {
  await saveConfig({ approvedSession: null });
  uiState.activeSession = null;
  uiState.lastSessionOutcome = "revoked";
  notifyPopup();

  await ensureRelayConnected();
  sendWs({ type: "SESSION_REVOKE", sessionId });
  return { ok: true, relayState: { ...uiState } };
}

export async function revokePairedPhone(phoneId: string): Promise<CommandResult> {
  const cfg = await loadConfig();
  const patch: Partial<StoredRelayConfig> = {};
  if (cfg.approvedSession?.phoneId === phoneId) {
    patch.approvedSession = null;
    uiState.activeSession = null;
    uiState.lastSessionOutcome = "revoked";
  }
  if (cfg.favoritePhoneId === phoneId) {
    patch.favoritePhoneId = null;
    uiState.favoritePhoneId = null;
  }
  if (Object.keys(patch).length > 0) {
    await saveConfig(patch);
  }
  notifyPopup();

  await ensureRelayConnected();
  sendWs({ type: "PAIRING_REVOKE", phoneId });
  return { ok: true, relayState: { ...uiState } };
}

export async function setFavoritePhone(
  phoneId: string | null,
): Promise<CommandResult> {
  await saveConfig({ favoritePhoneId: phoneId });
  uiState.favoritePhoneId = phoneId;
  notifyPopup();
  return { ok: true, relayState: { ...uiState } };
}

function buildRemoteSnapshot(
  rxState: ReceiverState,
  overridePlayer?: PlayerSnapshot | null,
) {
  const base: PlayerSnapshot = overridePlayer ??
    rxState.player ?? {
      status: "missing_player",
      videoId: null,
      title: rxState.designatedTab?.title ?? "No YouTube tab selected",
      url: rxState.designatedTab?.url ?? "",
      isPlaying: false,
      paused: true,
      ended: false,
      currentTime: 0,
      duration: null,
      isLive: false,
      canSeek: false,
      volume: 100,
      muted: false,
      playbackBlocked: false,
      updatedAt: Date.now(),
    };
  return {
    ...base,
    designatedTabId: rxState.designatedTabId,
    availableTabs: rxState.availableTabs,
  };
}

export function pushReceiverStateToRelay(rxState: ReceiverState): void {
  sendWs({
    type: "RECEIVER_PLAYER_STATE",
    snapshot: buildRemoteSnapshot(rxState),
  });
}
