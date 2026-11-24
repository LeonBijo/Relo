import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTrustedExtensionSender,
  validatePlaybackCommand,
} from "../src/shared/protocol.ts";

describe("validatePlaybackCommand", () => {
  it("accepts valid commands and normalizes volume", () => {
    assert.deepEqual(validatePlaybackCommand({ type: "PLAY" }), {
      ok: true,
      command: { type: "PLAY" },
    });
    assert.deepEqual(
      validatePlaybackCommand({ type: "SEEK_RELATIVE", deltaSeconds: -10 }),
      { ok: true, command: { type: "SEEK_RELATIVE", deltaSeconds: -10 } },
    );
    assert.deepEqual(
      validatePlaybackCommand({ type: "SEEK_TO", timeSeconds: 42.5 }),
      { ok: true, command: { type: "SEEK_TO", timeSeconds: 42.5 } },
    );
    assert.deepEqual(
      validatePlaybackCommand({ type: "SET_VOLUME", volume: 65.6 }),
      { ok: true, command: { type: "SET_VOLUME", volume: 66 } },
    );
    assert.deepEqual(
      validatePlaybackCommand({ type: "SET_MUTED", muted: true }),
      { ok: true, command: { type: "SET_MUTED", muted: true } },
    );
  });

  it("rejects invalid command types and out-of-range numbers", () => {
    const invalid = [
      null,
      {},
      { type: "UNKNOWN" },
      { type: "SEEK_RELATIVE", deltaSeconds: Number.NaN },
      { type: "SEEK_RELATIVE", deltaSeconds: 99999 },
      { type: "SEEK_TO", timeSeconds: -1 },
      { type: "SEEK_TO", timeSeconds: Number.POSITIVE_INFINITY },
      { type: "SET_VOLUME", volume: -5 },
      { type: "SET_VOLUME", volume: 101 },
      { type: "SET_MUTED", muted: "yes" },
    ];

    for (const cmd of invalid) {
      const res = validatePlaybackCommand(cmd);
      assert.equal(res.ok, false, `Expected invalid for ${JSON.stringify(cmd)}`);
    }
  });
});

describe("isTrustedExtensionSender", () => {
  it("only trusts senders matching the extension ID", () => {
    assert.equal(
      isTrustedExtensionSender(
        { id: "ext-123" } as chrome.runtime.MessageSender,
        "ext-123",
      ),
      true,
    );
    assert.equal(
      isTrustedExtensionSender(
        { id: "other-ext" } as chrome.runtime.MessageSender,
        "ext-123",
      ),
      false,
    );
    assert.equal(
      isTrustedExtensionSender({} as chrome.runtime.MessageSender, "ext-123"),
      false,
    );
  });
});
