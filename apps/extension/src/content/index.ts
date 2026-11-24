import {
  type BackgroundToContentMessage,
  type CommandResult,
  type ContentToBackgroundMessage,
  type PlaybackCommand,
  type PlayerSnapshot,
  isTrustedExtensionSender,
  validatePlaybackCommand,
} from "../shared/protocol";
import { extractYouTubeVideoId } from "../shared/youtubeUrl";

declare global {
  interface Window {
    __RELO_CONTENT_INITIALIZED__?: boolean;
  }
}

function getYouTubeVideoElement(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("video")
  );
}

function getYouTubeVideoTitle(): string {
  const selectors = [
    "h1.ytd-watch-metadata yt-formatted-string",
    "#title h1 yt-formatted-string",
    "#title h1",
    "ytd-reel-video-renderer[is-active] h2",
  ];
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  const docTitle = document.title.replace(/\s*-\s*YouTube$/, "").trim();
  return docTitle || "YouTube";
}

function isYouTubeLiveStream(video: HTMLVideoElement): boolean {
  if (video.duration === Infinity) return true;
  const liveBadge = document.querySelector<HTMLElement>(".ytp-live-badge");
  if (liveBadge && !liveBadge.hasAttribute("disabled")) {
    const style = window.getComputedStyle(liveBadge);
    if (style.display !== "none" && style.visibility !== "hidden") {
      return true;
    }
  }
  return false;
}

function readPlayerSnapshot(
  overrideError?: Pick<PlayerSnapshot, "playbackBlocked" | "errorCode" | "errorMessage">,
): PlayerSnapshot {
  const video = getYouTubeVideoElement();
  const url = window.location.href;
  const videoId = extractYouTubeVideoId(url);
  const title = getYouTubeVideoTitle();
  const now = Date.now();

  if (!video) {
    return {
      status: "missing_player",
      videoId,
      title,
      url,
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
      errorCode: "MISSING_PLAYER",
      errorMessage:
        "No active YouTube video player was found on this tab. Open a video or paste a link above.",
      updatedAt: now,
    };
  }

  const isLive = isYouTubeLiveStream(video);
  const rawDuration = video.duration;
  const duration =
    !isLive && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : null;
  const currentTime =
    Number.isFinite(video.currentTime) && video.currentTime >= 0
      ? video.currentTime
      : 0;
  const canSeek =
    !isLive &&
    duration !== null &&
    duration > 0 &&
    video.seekable.length > 0;
  const isLoading = video.readyState === 0 && !video.ended && video.networkState === 2;

  return {
    status: overrideError?.errorCode ? "error" : isLoading ? "loading" : "ready",
    videoId,
    title,
    url,
    isPlaying: !video.paused && !video.ended && video.readyState >= 2,
    paused: video.paused,
    ended: video.ended,
    currentTime,
    duration,
    isLive,
    canSeek,
    volume: Math.round((Number.isFinite(video.volume) ? video.volume : 1) * 100),
    muted: Boolean(video.muted),
    playbackBlocked: overrideError?.playbackBlocked ?? false,
    errorCode: overrideError?.errorCode,
    errorMessage: overrideError?.errorMessage,
    updatedAt: now,
  };
}

async function executePlayerCommand(
  command: PlaybackCommand,
): Promise<CommandResult> {
  const video = getYouTubeVideoElement();
  if (!video) {
    const snapshot = readPlayerSnapshot();
    return {
      ok: false,
      snapshot,
      error: snapshot.errorMessage,
      errorCode: "MISSING_PLAYER",
    };
  }

  switch (command.type) {
    case "PLAY": {
      try {
        await video.play();
        const snapshot = readPlayerSnapshot();
        return { ok: true, snapshot };
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Playback was blocked by Chrome autoplay rules. Click Play once in the YouTube tab to enable playback."
            : err instanceof Error
              ? err.message
              : "Unable to start playback.";
        const snapshot = readPlayerSnapshot({
          playbackBlocked: true,
          errorCode: "PLAYBACK_BLOCKED",
          errorMessage: message,
        });
        return {
          ok: false,
          snapshot,
          error: message,
          errorCode: "PLAYBACK_BLOCKED",
        };
      }
    }

    case "PAUSE": {
      video.pause();
      return { ok: true, snapshot: readPlayerSnapshot() };
    }

    case "TOGGLE_PLAY": {
      if (video.paused || video.ended) {
        return executePlayerCommand({ type: "PLAY" });
      }
      video.pause();
      return { ok: true, snapshot: readPlayerSnapshot() };
    }

    case "SEEK_RELATIVE": {
      const currentSnapshot = readPlayerSnapshot();
      if (!currentSnapshot.canSeek || currentSnapshot.duration === null) {
        return {
          ok: false,
          snapshot: currentSnapshot,
          error: currentSnapshot.isLive
            ? "Seeking is unavailable for live streams."
            : "Video duration is not available yet.",
        };
      }
      const target = Math.max(
        0,
        Math.min(currentSnapshot.duration, video.currentTime + command.deltaSeconds),
      );
      video.currentTime = target;
      return { ok: true, snapshot: readPlayerSnapshot() };
    }

    case "SEEK_TO": {
      const currentSnapshot = readPlayerSnapshot();
      if (!currentSnapshot.canSeek || currentSnapshot.duration === null) {
        return {
          ok: false,
          snapshot: currentSnapshot,
          error: currentSnapshot.isLive
            ? "Seeking is unavailable for live streams."
            : "Video duration is not available yet.",
        };
      }
      const target = Math.max(
        0,
        Math.min(currentSnapshot.duration, command.timeSeconds),
      );
      video.currentTime = target;
      return { ok: true, snapshot: readPlayerSnapshot() };
    }

    case "SET_VOLUME": {
      const clamped = Math.max(0, Math.min(100, command.volume));
      video.volume = clamped / 100;
      if (clamped > 0 && video.muted) {
        video.muted = false;
      }
      return { ok: true, snapshot: readPlayerSnapshot() };
    }

    case "SET_MUTED": {
      video.muted = command.muted;
      return { ok: true, snapshot: readPlayerSnapshot() };
    }
  }
}

function initContentScript() {
  if (window.__RELO_CONTENT_INITIALIZED__) return;
  window.__RELO_CONTENT_INITIALIZED__ = true;

  let trackedVideo: HTMLVideoElement | null = null;
  let lastEmitAt = 0;
  let throttledTimer: number | null = null;

  const sendToBackground = (message: ContentToBackgroundMessage) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Extension context may be invalidated during reload
    }
  };

  const emitSnapshotNow = () => {
    lastEmitAt = Date.now();
    if (throttledTimer !== null) {
      window.clearTimeout(throttledTimer);
      throttledTimer = null;
    }
    sendToBackground({
      type: "PLAYER_STATE_CHANGED",
      snapshot: readPlayerSnapshot(),
    });
  };

  const emitSnapshotThrottled = () => {
    const elapsed = Date.now() - lastEmitAt;
    if (elapsed >= 500) {
      emitSnapshotNow();
      return;
    }
    if (throttledTimer === null) {
      throttledTimer = window.setTimeout(() => {
        throttledTimer = null;
        emitSnapshotNow();
      }, 500 - elapsed);
    }
  };

  const onEnded = () => {
    const snapshot = readPlayerSnapshot();
    sendToBackground({
      type: "VIDEO_ENDED",
      videoId: snapshot.videoId,
      title: snapshot.title,
      endedAt: Date.now(),
    });
    emitSnapshotNow();
  };

  const attachVideoListeners = (video: HTMLVideoElement | null) => {
    if (trackedVideo === video) return;

    if (trackedVideo) {
      trackedVideo.removeEventListener("play", emitSnapshotNow);
      trackedVideo.removeEventListener("pause", emitSnapshotNow);
      trackedVideo.removeEventListener("playing", emitSnapshotNow);
      trackedVideo.removeEventListener("waiting", emitSnapshotNow);
      trackedVideo.removeEventListener("seeked", emitSnapshotNow);
      trackedVideo.removeEventListener("volumechange", emitSnapshotNow);
      trackedVideo.removeEventListener("loadedmetadata", emitSnapshotNow);
      trackedVideo.removeEventListener("durationchange", emitSnapshotNow);
      trackedVideo.removeEventListener("timeupdate", emitSnapshotThrottled);
      trackedVideo.removeEventListener("ended", onEnded);
    }

    trackedVideo = video;

    if (trackedVideo) {
      trackedVideo.addEventListener("play", emitSnapshotNow);
      trackedVideo.addEventListener("pause", emitSnapshotNow);
      trackedVideo.addEventListener("playing", emitSnapshotNow);
      trackedVideo.addEventListener("waiting", emitSnapshotNow);
      trackedVideo.addEventListener("seeked", emitSnapshotNow);
      trackedVideo.addEventListener("volumechange", emitSnapshotNow);
      trackedVideo.addEventListener("loadedmetadata", emitSnapshotNow);
      trackedVideo.addEventListener("durationchange", emitSnapshotNow);
      trackedVideo.addEventListener("timeupdate", emitSnapshotThrottled);
      trackedVideo.addEventListener("ended", onEnded);
      emitSnapshotNow();
    }
  };

  attachVideoListeners(getYouTubeVideoElement());

  const observer = new MutationObserver(() => {
    const currentVideo = getYouTubeVideoElement();
    if (currentVideo !== trackedVideo) {
      attachVideoListeners(currentVideo);
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  document.addEventListener("yt-navigate-finish", () => {
    attachVideoListeners(getYouTubeVideoElement());
    emitSnapshotNow();
  });

  chrome.runtime.onMessage.addListener(
    (
      message: BackgroundToContentMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: CommandResult) => void,
    ) => {
      if (!isTrustedExtensionSender(sender, chrome.runtime.id)) {
        sendResponse({ ok: false, error: "Untrusted message sender." });
        return false;
      }

      if (!message || typeof message !== "object") {
        sendResponse({ ok: false, error: "Invalid message." });
        return false;
      }

      if (message.type === "GET_PLAYER_STATE") {
        attachVideoListeners(getYouTubeVideoElement());
        sendResponse({ ok: true, snapshot: readPlayerSnapshot() });
        return false;
      }

      if (message.type === "EXECUTE_COMMAND") {
        const validation = validatePlaybackCommand(message.command);
        if (!validation.ok) {
          sendResponse({ ok: false, error: validation.error });
          return false;
        }
        executePlayerCommand(validation.command).then(sendResponse);
        return true;
      }

      return false;
    },
  );
}

initContentScript();
