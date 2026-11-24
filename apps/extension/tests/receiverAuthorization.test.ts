import { describe, it } from "node:test";
import assert from "node:assert/strict";

const approvedSession = {
  sessionId: "sess-1",
  phoneId: "ph-1",
  phoneName: "Leon's phone",
  receiverId: "rx-12345678",
  status: "active" as const,
  createdAt: Date.now() - 1000,
  requestExpiresAt: Date.now() + 60_000,
  expiresAt: Date.now() + 60_000,
  revoked: false,
};

const storageData: Record<string, unknown> = {
  reloRelayConfig: {
    receiverId: "rx-12345678",
    receiverSecret: "secret-1234567890123456",
    deviceName: "My Desktop",
    relayUrl: "ws://localhost:8787/ws",
    approvedSession,
  },
};

(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: storageData[key] };
      },
      async set(items: Record<string, unknown>) {
        Object.assign(storageData, items);
      },
    },
  },
  runtime: {
    sendMessage: async () => ({}),
  },
  tabs: {
    async query() {
      return [];
    },
    async get() {
      throw new Error("no tab");
    },
  },
  scripting: {
    async executeScript() {
      return [];
    },
  },
  windows: {
    async update() {
      return {};
    },
  },
};

const {
  getRelayUiState,
  isRemoteSessionAuthorized,
  revokeActiveSession,
  setFavoritePhone,
  setRelayConfig,
} = await import("../src/background/relayClient.ts");

describe("receiver-side remote session authorization & config", () => {
  it("authorizes matching active session, rejects mismatched phone/session, and rejects after revocation", async () => {
    const valid = await isRemoteSessionAuthorized("sess-1", "ph-1");
    assert.equal(valid.ok, true);

    const wrongPhone = await isRemoteSessionAuthorized("sess-1", "ph-other");
    assert.equal(wrongPhone.ok, false);

    const wrongSession = await isRemoteSessionAuthorized("sess-other", "ph-1");
    assert.equal(wrongSession.ok, false);

    await revokeActiveSession("sess-1");
    const afterRevoke = await isRemoteSessionAuthorized("sess-1", "ph-1");
    assert.equal(afterRevoke.ok, false);
  });

  it("populates default relayUrl and reports failure when setRelayConfig cannot reach relay", async () => {
    const state = await getRelayUiState();
    assert.equal(state.relayUrl, "ws://localhost:8787/ws");

    const badProtocol = await setRelayConfig("Desktop", "http://localhost:8787");
    assert.equal(badProtocol.ok, false);
    assert.match(badProtocol.error ?? "", /ws:\/\/ or wss:\/\//i);

    const unreachable = await setRelayConfig(
      "Desktop",
      "ws://127.0.0.1:59999/ws",
    );
    assert.equal(unreachable.ok, false);
    assert.equal(unreachable.relayState?.connectionStatus, "offline");
    assert.ok(unreachable.error);

    const fav = await setFavoritePhone("ph-1");
    assert.equal(fav.ok, true);
    assert.equal(fav.relayState?.favoritePhoneId, "ph-1");

    const unfav = await setFavoritePhone(null);
    assert.equal(unfav.ok, true);
    assert.equal(unfav.relayState?.favoritePhoneId, null);
  });
});
