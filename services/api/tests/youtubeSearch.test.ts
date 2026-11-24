import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  YouTubeSearchService,
  formatIsoDuration,
} from "../src/youtubeSearch.ts";

describe("formatIsoDuration", () => {
  it("formats YouTube ISO 8601 durations cleanly", () => {
    assert.equal(formatIsoDuration("PT4M12S"), "4∶12");
    assert.equal(formatIsoDuration("PT1H02M05S"), "1∶02∶05");
    assert.equal(formatIsoDuration("PT0S"), "Live");
    assert.equal(formatIsoDuration(undefined), "—");
  });
});

describe("YouTubeSearchService", () => {
  it("validates query, handles missing API key, and handles quota errors without leaking keys", async () => {
    const missingKeyService = new YouTubeSearchService({
      getApiKey: () => undefined,
    });

    const empty = await missingKeyService.search("   ");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.errorCode, "EMPTY_QUERY");

    const missing = await missingKeyService.search("lofi");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.errorCode, "API_KEY_MISSING");

    const quotaService = new YouTubeSearchService({
      getApiKey: () => "secret-test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: "quotaExceeded" }] },
          }),
          { status: 403 },
        ),
    });

    const quotaRes = await quotaService.search("lofi");
    assert.equal(quotaRes.ok, false);
    if (!quotaRes.ok) {
      assert.equal(quotaRes.errorCode, "QUOTA_EXCEEDED");
      assert.equal(quotaRes.error.includes("secret-test-key"), false);
    }
  });

  it("returns normalized search results with duration and caches repeated queries", async () => {
    let fetchCalls = 0;
    const service = new YouTubeSearchService({
      getApiKey: () => "secret-test-key",
      fetchImpl: async (url) => {
        fetchCalls++;
        const u = String(url);
        if (u.includes("/youtube/v3/search")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: { videoId: "dQw4w9WgXcQ" },
                  snippet: {
                    title: "Rick &amp; Roll",
                    channelTitle: "Official Channel",
                    thumbnails: { medium: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" } },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "dQw4w9WgXcQ",
                contentDetails: { duration: "PT3M33S" },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const first = await service.search("Rick Roll");
    assert.equal(first.ok, true);
    assert.equal(fetchCalls, 2);
    if (first.ok) {
      assert.equal(first.cached, false);
      assert.equal(first.results.length, 1);
      assert.equal(first.results[0].title, "Rick & Roll");
      assert.equal(first.results[0].durationText, "3∶33");
      assert.equal(
        first.results[0].watchUrl,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
    }

    const second = await service.search("  rick roll  ");
    assert.equal(second.ok, true);
    assert.equal(fetchCalls, 2);
    if (second.ok) {
      assert.equal(second.cached, true);
    }
  });

  it("fetches and caches autocomplete suggestions with zero API quota", async () => {
    let suggestCalls = 0;
    const service = new YouTubeSearchService({
      fetchImpl: async () => {
        suggestCalls++;
        return new Response(
          JSON.stringify(["lofi", ["lofi hip hop", "lofi beats", "lofi chill"]]),
          { status: 200 },
        );
      },
    });

    const tooShort = await service.suggest("a");
    assert.deepEqual(tooShort, []);
    assert.equal(suggestCalls, 0);

    const first = await service.suggest("lofi");
    assert.deepEqual(first, ["lofi hip hop", "lofi beats", "lofi chill"]);
    assert.equal(suggestCalls, 1);

    const second = await service.suggest("LOFI");
    assert.deepEqual(second, ["lofi hip hop", "lofi beats", "lofi chill"]);
    assert.equal(suggestCalls, 1);
  });
});
