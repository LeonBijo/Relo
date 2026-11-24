import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelayServer } from "../src/server.ts";

function nextMessage(ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 3000);

    function onMsg(data: WebSocket.RawData) {
      const parsed = JSON.parse(String(data)) as Record<string, unknown>;
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(parsed);
      }
    }

    ws.on("message", onMsg);
  });
}

describe("Relay WebSocket end-to-end flow", () => {
  const relay = createRelayServer();
  let wsUrl = "";

  before(async () => {
    const { port } = await relay.start(0, "127.0.0.1");
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  after(async () => {
    await relay.stop();
  });

  it("completes pairing -> approval -> video link -> play/pause -> revocation", async () => {
    const rx = new WebSocket(wsUrl);
    const ph = new WebSocket(wsUrl);

    await Promise.all([
      new Promise<void>((res) => rx.once("open", () => res())),
      new Promise<void>((res) => ph.once("open", () => res())),
    ]);

    const rxAuthOk = nextMessage(rx, (m) => m.type === "AUTH_OK");
    rx.send(
      JSON.stringify({
        type: "RECEIVER_AUTH",
        receiverId: "rx-e2e-1",
        secret: "rx-secret-1234567890",
        deviceName: "Dia Mac",
      }),
    );
    await rxAuthOk;

    const phAuthOk = nextMessage(ph, (m) => m.type === "AUTH_OK");
    ph.send(
      JSON.stringify({
        type: "PHONE_AUTH",
        phoneId: "ph-e2e-1",
        secret: "ph-secret-1234567890",
        phoneName: "Leon's phone",
      }),
    );
    await phAuthOk;

    // 1. Desktop creates PIN
    const pinCreatedP = nextMessage(rx, (m) => m.type === "PAIRING_PIN_CREATED");
    rx.send(JSON.stringify({ type: "CREATE_PAIRING_PIN" }));
    const pinCreated = await pinCreatedP;
    const pin = String(pinCreated.pin);
    assert.match(pin, /^\d{6}$/);

    // 2. Phone submits PIN -> desktop receives PAIR_INCOMING
    const pairIncomingP = nextMessage(rx, (m) => m.type === "PAIR_INCOMING");
    ph.send(JSON.stringify({ type: "PAIR_SUBMIT", pin }));
    const pairIncoming = await pairIncomingP;
    assert.equal(pairIncoming.phoneId, "ph-e2e-1");

    // 3. Desktop confirms pairing -> phone receives PAIR_RESULT
    const pairResultP = nextMessage(ph, (m) => m.type === "PAIR_RESULT");
    rx.send(
      JSON.stringify({
        type: "PAIR_CONFIRM",
        phoneId: "ph-e2e-1",
        approve: true,
      }),
    );
    const pairResult = await pairResultP;
    assert.equal(pairResult.approved, true);

    // 4. Phone requests control session -> desktop receives SESSION_INCOMING
    const sessionIncomingP = nextMessage(rx, (m) => m.type === "SESSION_INCOMING");
    ph.send(
      JSON.stringify({ type: "SESSION_REQUEST", receiverId: "rx-e2e-1" }),
    );
    const sessionIncoming = await sessionIncomingP;
    const session = sessionIncoming.session as { sessionId: string };
    assert.ok(session.sessionId);

    // 5. Desktop approves session -> phone receives SESSION_UPDATED active
    const sessionActiveP = nextMessage(
      ph,
      (m) =>
        m.type === "SESSION_UPDATED" &&
        (m.session as { status?: string })?.status === "active",
    );
    rx.send(
      JSON.stringify({
        type: "SESSION_RESPOND",
        sessionId: session.sessionId,
        approve: true,
      }),
    );
    await sessionActiveP;

    // 6. Phone sends PLAY_VIDEO_URL -> desktop executes & replies
    const rxExecP = nextMessage(rx, (m) => m.type === "EXECUTE_REMOTE_COMMAND");
    const phCmdResP = nextMessage(
      ph,
      (m) => m.type === "REMOTE_COMMAND_RESULT" && m.commandId === "cmd-e2e-1",
    );
    ph.send(
      JSON.stringify({
        type: "REMOTE_COMMAND",
        receiverId: "rx-e2e-1",
        sessionId: session.sessionId,
        commandId: "cmd-e2e-1",
        action: { type: "PLAY_VIDEO_URL", url: "https://youtu.be/dQw4w9WgXcQ" },
      }),
    );
    const rxExec = await rxExecP;
    assert.deepEqual(rxExec.action, {
      type: "PLAY_VIDEO_URL",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    rx.send(
      JSON.stringify({
        type: "COMMAND_RESULT",
        commandId: "cmd-e2e-1",
        ok: true,
      }),
    );
    const phCmdRes = await phCmdResP;
    assert.equal(phCmdRes.ok, true);

    // 7. Desktop revokes session -> phone command is blocked
    const revokedP = nextMessage(
      ph,
      (m) =>
        m.type === "SESSION_UPDATED" &&
        (m.session as { status?: string })?.status === "revoked",
    );
    rx.send(
      JSON.stringify({
        type: "SESSION_REVOKE",
        sessionId: session.sessionId,
      }),
    );
    await revokedP;

    const blockedResP = nextMessage(
      ph,
      (m) => m.type === "REMOTE_COMMAND_RESULT" && m.commandId === "cmd-e2e-2",
    );
    ph.send(
      JSON.stringify({
        type: "REMOTE_COMMAND",
        receiverId: "rx-e2e-1",
        sessionId: session.sessionId,
        commandId: "cmd-e2e-2",
        action: { type: "PLAYER_COMMAND", command: { type: "PAUSE" } },
      }),
    );
    const blockedRes = await blockedResP;
    assert.equal(blockedRes.ok, false);
    assert.equal(blockedRes.errorCode, "SESSION_REVOKED");

    rx.close();
    ph.close();
  });
});
