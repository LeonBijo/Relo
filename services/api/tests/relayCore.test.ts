import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RelayCore } from "../src/relayCore.ts";

function setupPairedCore(nowRef = { t: 1_000_000 }) {
  const core = new RelayCore({
    pinTtlMs: 120_000,
    sessionRequestTtlMs: 60_000,
    sessionTtlMs: 300_000,
    maxPinAttemptsPerWindow: 5,
    pinAttemptWindowMs: 60_000,
    now: () => nowRef.t,
  });

  const rxAuth = core.authenticateReceiver(
    "rx-desktop-1",
    "secret-receiver-1234567890",
    "My MacBook",
  );
  assert.equal(rxAuth.ok, true);

  const phAuth = core.authenticatePhone(
    "ph-phone-1",
    "secret-phone-1234567890",
    "Leon's phone",
  );
  assert.equal(phAuth.ok, true);

  return { core, nowRef };
}

describe("RelayCore pairing PIN security", () => {
  it("rejects wrong PINs, enforces rate limiting, and rejects expired/reused PINs", () => {
    const { core, nowRef } = setupPairedCore();
    const pinRes = core.createPairingPin("rx-desktop-1");
    assert.equal(pinRes.ok, true);
    if (!pinRes.ok) return;

    // Wrong PIN
    const wrong = core.submitPairingPin("ph-phone-1", "000000", "rate-1");
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.errorCode, "WRONG_PIN");

    // Exhaust rate limit (already 1 attempt, 4 more = 5 total, 6th is RATE_LIMITED)
    for (let i = 0; i < 4; i++) {
      core.submitPairingPin("ph-phone-1", "000001", "rate-1");
    }
    const limited = core.submitPairingPin("ph-phone-1", pinRes.pin, "rate-1");
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.equal(limited.errorCode, "RATE_LIMITED");

    // Advance past rate window, then expire the PIN
    nowRef.t += 61_000;
    nowRef.t += 60_000; // total 121s > 120s TTL
    const expired = core.submitPairingPin("ph-phone-1", pinRes.pin, "rate-1");
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.errorCode, "PIN_EXPIRED");

    // Create fresh PIN, submit, confirm, then try reusing the same PIN
    const pin2 = core.createPairingPin("rx-desktop-1");
    assert.equal(pin2.ok, true);
    if (!pin2.ok) return;

    const sub = core.submitPairingPin("ph-phone-1", pin2.pin, "rate-2");
    assert.equal(sub.ok, true);

    // Second phone cannot reuse a PIN already pending confirmation
    core.authenticatePhone("ph-phone-2", "secret-phone2-1234567890", "Other");
    const reusePending = core.submitPairingPin("ph-phone-2", pin2.pin, "rate-3");
    assert.equal(reusePending.ok, false);
    if (!reusePending.ok) assert.equal(reusePending.errorCode, "PIN_USED");

    const conf = core.confirmPairing("rx-desktop-1", "ph-phone-1", true);
    assert.equal(conf.ok, true);

    // Cannot reuse consumed PIN
    const reuseConsumed = core.submitPairingPin("ph-phone-2", pin2.pin, "rate-3");
    assert.equal(reuseConsumed.ok, false);
    if (!reuseConsumed.ok) assert.equal(reuseConsumed.errorCode, "PIN_USED");
  });
});

describe("RelayCore session approval, cross-device, expiry, revocation, and reconnect", () => {
  it("enforces approval gating, blocks cross-device access, and handles denial/expiry/revocation", () => {
    const { core, nowRef } = setupPairedCore();
    const pin = core.createPairingPin("rx-desktop-1");
    assert.equal(pin.ok, true);
    if (!pin.ok) return;

    assert.equal(
      core.submitPairingPin("ph-phone-1", pin.pin, "r1").ok,
      true,
    );
    assert.equal(
      core.confirmPairing("rx-desktop-1", "ph-phone-1", true).ok,
      true,
    );

    // Pair a second phone too
    core.authenticatePhone("ph-phone-2", "secret-phone2-1234567890", "Guest");

    // Unpaired phone cannot request a session
    const unpairedReq = core.requestSession("ph-phone-2", "rx-desktop-1");
    assert.equal(unpairedReq.ok, false);
    if (!unpairedReq.ok) assert.equal(unpairedReq.errorCode, "NOT_PAIRED");

    // Paired phone requests session -> pending -> commands blocked
    const req1 = core.requestSession("ph-phone-1", "rx-desktop-1");
    assert.equal(req1.ok, true);
    if (!req1.ok) return;

    const beforeApproval = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req1.session.sessionId,
      "cmd-1",
      { type: "PLAYER_COMMAND", command: { type: "PLAY" } },
    );
    assert.equal(beforeApproval.ok, false);
    if (!beforeApproval.ok) {
      assert.equal(beforeApproval.errorCode, "APPROVAL_PENDING");
    }

    // Deny session -> commands blocked
    const deny = core.respondToSession(
      "rx-desktop-1",
      req1.session.sessionId,
      false,
    );
    assert.equal(deny.ok, true);
    const afterDeny = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req1.session.sessionId,
      "cmd-2",
      { type: "PLAYER_COMMAND", command: { type: "PLAY" } },
    );
    assert.equal(afterDeny.ok, false);
    if (!afterDeny.ok) assert.equal(afterDeny.errorCode, "SESSION_DENIED");

    // Request fresh session -> approve -> authorized
    const req2 = core.requestSession("ph-phone-1", "rx-desktop-1");
    assert.equal(req2.ok, true);
    if (!req2.ok) return;
    assert.equal(
      core.respondToSession("rx-desktop-1", req2.session.sessionId, true).ok,
      true,
    );

    // Cross-device access: phone 2 cannot use phone 1's sessionId
    const crossDevice = core.authorizeCommand(
      "ph-phone-2",
      "rx-desktop-1",
      req2.session.sessionId,
      "cmd-cross",
      { type: "PLAYER_COMMAND", command: { type: "PLAY" } },
    );
    assert.equal(crossDevice.ok, false);
    if (!crossDevice.ok) {
      assert.equal(crossDevice.errorCode, "UNAUTHORIZED_SESSION");
    }

    // Valid command + duplicate idempotency
    const cmdOk = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req2.session.sessionId,
      "cmd-3",
      { type: "PLAY_VIDEO_URL", url: "https://youtu.be/dQw4w9WgXcQ" },
    );
    assert.equal(cmdOk.ok, true);
    core.recordCommandResult(req2.session.sessionId, "cmd-3", { ok: true });

    const dup = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req2.session.sessionId,
      "cmd-3",
      { type: "PLAY_VIDEO_URL", url: "https://youtu.be/dQw4w9WgXcQ" },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);

    // Reconnect while session is still valid preserves active session
    core.setPhoneOffline("ph-phone-1");
    core.authenticatePhone("ph-phone-1", "secret-phone-1234567890");
    const reconnectState = core.getPhoneStateSnapshot("ph-phone-1");
    assert.equal(reconnectState.pairedReceivers[0].session?.status, "active");

    // Revocation immediately blocks further commands
    core.revokeSession("rx-desktop-1", req2.session.sessionId);
    const afterRevoke = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req2.session.sessionId,
      "cmd-4",
      { type: "PLAYER_COMMAND", command: { type: "PAUSE" } },
    );
    assert.equal(afterRevoke.ok, false);
    if (!afterRevoke.ok) assert.equal(afterRevoke.errorCode, "SESSION_REVOKED");

    // Expiry check on a new session
    const req3 = core.requestSession("ph-phone-1", "rx-desktop-1");
    assert.equal(req3.ok, true);
    if (!req3.ok) return;
    core.respondToSession("rx-desktop-1", req3.session.sessionId, true);
    nowRef.t += 301_000; // past 300s sessionTtlMs
    const afterExpiry = core.authorizeCommand(
      "ph-phone-1",
      "rx-desktop-1",
      req3.session.sessionId,
      "cmd-5",
      { type: "PLAYER_COMMAND", command: { type: "PLAY" } },
    );
    assert.equal(afterExpiry.ok, false);
    if (!afterExpiry.ok) assert.equal(afterExpiry.errorCode, "SESSION_EXPIRED");
  });
});
