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

export type PlaybackCommand =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE_PLAY" }
  | { type: "SEEK_RELATIVE"; deltaSeconds: number }
  | { type: "SEEK_TO"; timeSeconds: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "NEXT_VIDEO" };

export type RemoteAction =
  | { type: "PLAY_VIDEO_URL"; url: string }
  | { type: "PLAYER_COMMAND"; command: PlaybackCommand }
  | { type: "DESIGNATE_TAB"; tabId: number }
  | { type: "FOCUS_TAB" }
  | { type: "CLOSE_TAB" }
  | { type: "REFRESH_STATE" };

const YOUTUBE_WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_PATH_REGEX = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/;
const YOUTU_BE_PATH_REGEX = /^\/([A-Za-z0-9_-]{11})\/?$/;

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

const VALID_COMMAND_TYPES = new Set<PlaybackCommand["type"]>([
  "PLAY",
  "PAUSE",
  "TOGGLE_PLAY",
  "SEEK_RELATIVE",
  "SEEK_TO",
  "SET_VOLUME",
  "SET_MUTED",
  "NEXT_VIDEO",
]);

export function validatePlaybackCommand(
  raw: unknown,
): { ok: true; command: PlaybackCommand } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid playback command payload." };
  }

  const candidate = raw as Record<string, unknown>;
  const type = candidate.type;

  if (
    typeof type !== "string" ||
    !VALID_COMMAND_TYPES.has(type as PlaybackCommand["type"])
  ) {
    return { ok: false, error: "Unsupported playback command type." };
  }

  switch (type) {
    case "PLAY":
    case "PAUSE":
    case "TOGGLE_PLAY":
    case "NEXT_VIDEO":
      return { ok: true, command: { type } };

    case "SEEK_RELATIVE": {
      const delta = candidate.deltaSeconds;
      if (typeof delta !== "number" || !Number.isFinite(delta)) {
        return { ok: false, error: "Seek delta must be a finite number." };
      }
      if (delta < -3600 || delta > 3600) {
        return {
          ok: false,
          error: "Seek delta must be between -3600 and 3600 seconds.",
        };
      }
      return { ok: true, command: { type: "SEEK_RELATIVE", deltaSeconds: delta } };
    }

    case "SEEK_TO": {
      const time = candidate.timeSeconds;
      if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
        return {
          ok: false,
          error: "Seek position must be a non-negative finite number.",
        };
      }
      if (time > 86400 * 7) {
        return { ok: false, error: "Seek position exceeds supported range." };
      }
      return { ok: true, command: { type: "SEEK_TO", timeSeconds: time } };
    }

    case "SET_VOLUME": {
      const volume = candidate.volume;
      if (typeof volume !== "number" || !Number.isFinite(volume)) {
        return { ok: false, error: "Volume must be a finite number." };
      }
      if (volume < 0 || volume > 100) {
        return { ok: false, error: "Volume must be between 0 and 100." };
      }
      return {
        ok: true,
        command: { type: "SET_VOLUME", volume: Math.round(volume) },
      };
    }

    case "SET_MUTED": {
      if (typeof candidate.muted !== "boolean") {
        return { ok: false, error: "Muted value must be a boolean." };
      }
      return { ok: true, command: { type: "SET_MUTED", muted: candidate.muted } };
    }

    default:
      return { ok: false, error: "Unsupported playback command type." };
  }
}

export function validateRemoteAction(
  raw: unknown,
): { ok: true; action: RemoteAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid remote action." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type === "PLAY_VIDEO_URL") {
    if (typeof obj.url !== "string") {
      return { ok: false, error: "Video URL must be a string." };
    }
    const check = validateYouTubeVideoUrl(obj.url);
    if (!check.ok) return { ok: false, error: check.error };
    return { ok: true, action: { type: "PLAY_VIDEO_URL", url: check.canonicalUrl } };
  }
  if (obj.type === "PLAYER_COMMAND") {
    const check = validatePlaybackCommand(obj.command);
    if (!check.ok) return { ok: false, error: check.error };
    return { ok: true, action: { type: "PLAYER_COMMAND", command: check.command } };
  }
  if (obj.type === "DESIGNATE_TAB") {
    if (
      typeof obj.tabId !== "number" ||
      !Number.isInteger(obj.tabId) ||
      obj.tabId < 0
    ) {
      return { ok: false, error: "Tab ID must be a non-negative integer." };
    }
    return { ok: true, action: { type: "DESIGNATE_TAB", tabId: obj.tabId } };
  }
  if (obj.type === "FOCUS_TAB") {
    return { ok: true, action: { type: "FOCUS_TAB" } };
  }
  if (obj.type === "CLOSE_TAB") {
    return { ok: true, action: { type: "CLOSE_TAB" } };
  }
  if (obj.type === "REFRESH_STATE") {
    return { ok: true, action: { type: "REFRESH_STATE" } };
  }
  return { ok: false, error: "Unsupported remote action type." };
}
