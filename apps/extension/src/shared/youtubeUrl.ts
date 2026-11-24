export type YouTubeLinkKind = "watch" | "short_link" | "shorts";

export type YouTubeLinkValidationResult =
  | {
      ok: true;
      videoId: string;
      canonicalUrl: string;
      sourceKind: YouTubeLinkKind;
    }
  | {
      ok: false;
      error: string;
    };

const YOUTUBE_WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_PATH_REGEX = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/;
const YOUTU_BE_PATH_REGEX = /^\/([A-Za-z0-9_-]{11})\/?$/;

/**
 * Validates an HTTPS YouTube video link (watch, youtu.be, or shorts)
 * and constructs a canonical YouTube watch URL.
 */
export function validateYouTubeVideoUrl(
  rawInput: string,
): YouTubeLinkValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste an HTTPS YouTube video link." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid HTTPS YouTube video link." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Only HTTPS YouTube links are supported." };
  }

  if (parsed.username || parsed.password || parsed.port !== "") {
    return {
      ok: false,
      error: "Enter a standard YouTube link without credentials or custom ports.",
    };
  }

  const host = parsed.hostname.toLowerCase();

  if (host === "youtu.be") {
    const match = YOUTU_BE_PATH_REGEX.exec(parsed.pathname);
    if (!match) {
      return {
        ok: false,
        error: "Invalid youtu.be link. Expected an 11-character video ID.",
      };
    }
    const videoId = match[1];
    return {
      ok: true,
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceKind: "short_link",
    };
  }

  if (YOUTUBE_WATCH_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") {
      const videoId = parsed.searchParams.get("v") ?? "";
      if (!VIDEO_ID_REGEX.test(videoId)) {
        return {
          ok: false,
          error: "Missing or invalid 11-character YouTube video ID.",
        };
      }
      return {
        ok: true,
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        sourceKind: "watch",
      };
    }

    const shortsMatch = SHORTS_PATH_REGEX.exec(parsed.pathname);
    if (shortsMatch) {
      const videoId = shortsMatch[1];
      return {
        ok: true,
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        sourceKind: "shorts",
      };
    }

    return {
      ok: false,
      error:
        "Use a youtube.com/watch?v=ID, youtu.be/ID, or youtube.com/shorts/ID link.",
    };
  }

  return {
    ok: false,
    error: "Only youtube.com and youtu.be video links are supported.",
  };
}

/**
 * Checks whether a browser tab URL is a supported HTTPS YouTube page.
 */
export function isSupportedYouTubeTabUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password || parsed.port !== "") return false;
    return YOUTUBE_WATCH_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Extracts a YouTube video ID from a YouTube watch or shorts tab URL if present.
 */
export function extractYouTubeVideoId(rawUrl?: string | null): string | null {
  if (!rawUrl || !isSupportedYouTubeTabUrl(rawUrl)) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v") ?? "";
      return VIDEO_ID_REGEX.test(id) ? id : null;
    }
    const shortsMatch = SHORTS_PATH_REGEX.exec(parsed.pathname);
    return shortsMatch ? shortsMatch[1] : null;
  } catch {
    return null;
  }
}
