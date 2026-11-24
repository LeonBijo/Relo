import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractYouTubeVideoId,
  isSupportedYouTubeTabUrl,
  validateYouTubeVideoUrl,
} from "../src/shared/youtubeUrl.ts";

describe("validateYouTubeVideoUrl", () => {
  it("accepts standard HTTPS watch, youtu.be, and shorts links and canonicalizes them", () => {
    const cases = [
      ["https://youtube.com/watch?v=dQw4w9WgXcQ", "watch"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "watch"],
      ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "watch"],
      ["https://youtu.be/dQw4w9WgXcQ", "short_link"],
      ["https://youtu.be/dQw4w9WgXcQ?si=test123", "short_link"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "shorts"],
      ["https://youtube.com/shorts/dQw4w9WgXcQ/", "shorts"],
    ] as const;

    for (const [input, expectedKind] of cases) {
      const result = validateYouTubeVideoUrl(input);
      assert.equal(result.ok, true, `Expected valid for ${input}`);
      if (result.ok) {
        assert.equal(result.videoId, "dQw4w9WgXcQ");
        assert.equal(
          result.canonicalUrl,
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        );
        assert.equal(result.sourceKind, expectedKind);
      }
    }
  });

  it("rejects non-HTTPS, lookalike domains, userinfo/port tricks, and invalid IDs", () => {
    const invalidLinks = [
      "",
      "   ",
      "not a url",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://evilyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://not-youtube.com/watch?v=dQw4w9WgXcQ",
      "https://evil.youtu.be/dQw4w9WgXcQ",
      "https://youtu.be.evil.com/dQw4w9WgXcQ",
      "https://youtube.com@evil.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=toolong123456",
      "https://www.youtube.com/watch?v=dQw4w9WgXc!",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://youtu.be/",
      "https://www.youtube.com/",
    ];

    for (const input of invalidLinks) {
      const result = validateYouTubeVideoUrl(input);
      assert.equal(result.ok, false, `Expected invalid for ${input}`);
    }
  });
});

describe("isSupportedYouTubeTabUrl & extractYouTubeVideoId", () => {
  it("validates YouTube tab URLs and extracts IDs", () => {
    assert.equal(isSupportedYouTubeTabUrl("https://www.youtube.com/"), true);
    assert.equal(
      isSupportedYouTubeTabUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
      true,
    );
    assert.equal(isSupportedYouTubeTabUrl("https://evilyoutube.com/"), false);
    assert.equal(isSupportedYouTubeTabUrl("http://www.youtube.com/"), false);

    assert.equal(
      extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ",
    );
    assert.equal(
      extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ",
    );
    assert.equal(extractYouTubeVideoId("https://www.youtube.com/"), null);
  });
});
