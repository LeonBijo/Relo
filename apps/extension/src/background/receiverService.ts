import {
  type BackgroundToContentMessage,
  type CommandResult,
  type PlaybackCommand,
  type PlayerSnapshot,
  type ReceiverState,
  type YouTubeTabInfo,
  validatePlaybackCommand,
} from "../shared/protocol.ts";
import {
  extractYouTubeVideoId,
  isSupportedYouTubeTabUrl,
  validateYouTubeVideoUrl,
} from "../shared/youtubeUrl.ts";

const STORAGE_KEY = "reloReceiverStorage";

interface StoredReceiverData {
  designatedTabId: number | null;
  lastCompletedVideoId: string | null;
  lastCompletedAt: number | null;
}

const YOUTUBE_URL_PATTERNS = [
  "https://www.youtube.com/*",
  "https://youtube.com/*",
  "https://m.youtube.com/*",
];

let cachedStorage: StoredReceiverData | null = null;
let cachedPlayerSnapshot: PlayerSnapshot | null = null;
let cachedLastError: string | null = null;
let suppressAutoDesignate = false;
let mutationQueue: Promise<void> = Promise.resolve();

/**
 * Serializes receiver state mutations so concurrent requests execute in order.
 * A failed operation never blocks or poisons subsequent queued operations.
 */
function withReceiverLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadStoredData(): Promise<StoredReceiverData> {
  if (cachedStorage) return cachedStorage;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY] as Partial<StoredReceiverData> | undefined;
    cachedStorage = {
      designatedTabId:
        typeof raw?.designatedTabId === "number" ? raw.designatedTabId : null,
      lastCompletedVideoId:
        typeof raw?.lastCompletedVideoId === "string"
          ? raw.lastCompletedVideoId
          : null,
      lastCompletedAt:
        typeof raw?.lastCompletedAt === "number" ? raw.lastCompletedAt : null,
    };
  } catch {
    cachedStorage = {
      designatedTabId: null,
      lastCompletedVideoId: null,
      lastCompletedAt: null,
    };
  }
  return cachedStorage;
}

async function saveStoredData(patch: Partial<StoredReceiverData>): Promise<void> {
  const current = await loadStoredData();
  cachedStorage = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: cachedStorage });
}

function toYouTubeTabInfo(
  tab: chrome.tabs.Tab,
  designatedTabId: number | null,
): YouTubeTabInfo | null {
  if (typeof tab.id !== "number" || !isSupportedYouTubeTabUrl(tab.url)) {
    return null;
  }
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: (tab.title || "YouTube").replace(/\s*-\s*YouTube$/, "").trim() || "YouTube",
    url: tab.url!,
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    isDesignated: tab.id === designatedTabId,
  };
}

async function queryYouTubeTabs(
  designatedTabId: number | null,
): Promise<YouTubeTabInfo[]> {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_URL_PATTERNS });
  const mapped: YouTubeTabInfo[] = [];
  for (const tab of tabs) {
    const info = toYouTubeTabInfo(tab, designatedTabId);
    if (info) mapped.push(info);
  }
  return mapped;
}

async function validateDesignatedTab(
  designatedTabId: number | null,
): Promise<{ validTab: chrome.tabs.Tab | null; invalidReason: string | null }> {
  if (designatedTabId === null) {
    return { validTab: null, invalidReason: null };
  }
  try {
    const tab = await chrome.tabs.get(designatedTabId);
    if (!isSupportedYouTubeTabUrl(tab.url)) {
      return {
        validTab: null,
        invalidReason: "The designated tab navigated away from YouTube.",
      };
    }
    return { validTab: tab, invalidReason: null };
  } catch {
    return {
      validTab: null,
      invalidReason: "The previously designated YouTube tab was closed.",
    };
  }
}

async function sendMessageToTab(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<CommandResult> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as CommandResult;
  } catch {
    // Tab may have been open prior to extension load/reload; inject content.js once and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return (await chrome.tabs.sendMessage(tabId, message)) as CommandResult;
    } catch {
      return {
        ok: false,
        error:
          "Could not reach the YouTube tab receiver. Try reloading that YouTube tab.",
      };
    }
  }
}

export async function getReceiverState(): Promise<ReceiverState> {
  const stored = await loadStoredData();
  let designatedTabId = stored.designatedTabId;

  const validationResult = await validateDesignatedTab(designatedTabId);
  let validTab = validationResult.validTab;
  const invalidReason = validationResult.invalidReason;
  if (designatedTabId !== null && !validTab) {
    designatedTabId = null;
    cachedPlayerSnapshot = null;
    cachedLastError = invalidReason;
    await saveStoredData({ designatedTabId: null });
  }

  const availableTabs = await queryYouTubeTabs(designatedTabId);

  // Zero-click convenience: if no tab is designated and exactly one YouTube tab is open, auto-designate it.
  if (
    designatedTabId === null &&
    availableTabs.length === 1 &&
    !suppressAutoDesignate
  ) {
    const soleTabId = availableTabs[0].tabId;
    const check = await validateDesignatedTab(soleTabId);
    if (check.validTab) {
      designatedTabId = soleTabId;
      validTab = check.validTab;
      cachedLastError = null;
      await saveStoredData({ designatedTabId: soleTabId });
      availableTabs[0].isDesignated = true;
    }
  } else if (availableTabs.length !== 1) {
    suppressAutoDesignate = false;
  }

  const designatedTab =
    designatedTabId !== null
      ? availableTabs.find((t) => t.tabId === designatedTabId) ?? null
      : null;

  if (!validTab || designatedTabId === null) {
    return {
      designatedTabId: null,
      designatedTab: null,
      availableTabs,
      connectionState: "no_receiver",
      player: null,
      lastError: cachedLastError,
      lastCompletedVideoId: stored.lastCompletedVideoId,
      lastCompletedAt: stored.lastCompletedAt,
    };
  }

  if (validTab.status === "loading") {
    return {
      designatedTabId,
      designatedTab,
      availableTabs,
      connectionState: "loading",
      player: cachedPlayerSnapshot,
      lastError: null,
      lastCompletedVideoId: stored.lastCompletedVideoId,
      lastCompletedAt: stored.lastCompletedAt,
    };
  }

  const response = await sendMessageToTab(designatedTabId, {
    type: "GET_PLAYER_STATE",
  });

  if (!response?.ok || !response.snapshot) {
    return {
      designatedTabId,
      designatedTab,
      availableTabs,
      connectionState: "disconnected",
      player: cachedPlayerSnapshot,
      lastError: response?.error ?? "Receiver tab is disconnected.",
      lastCompletedVideoId: stored.lastCompletedVideoId,
      lastCompletedAt: stored.lastCompletedAt,
    };
  }

  cachedPlayerSnapshot = response.snapshot;
  const connectionState =
    response.snapshot.status === "missing_player"
      ? "missing_player"
      : response.snapshot.status === "loading"
        ? "loading"
        : "connected";

  return {
    designatedTabId,
    designatedTab,
    availableTabs,
    connectionState,
    player: response.snapshot,
    lastError: response.snapshot.errorMessage ?? null,
    lastCompletedVideoId: stored.lastCompletedVideoId,
    lastCompletedAt: stored.lastCompletedAt,
  };
}

export async function designateYouTubeTab(
  tabId: number,
): Promise<CommandResult> {
  return withReceiverLock(async () => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return { ok: false, error: "Invalid tab ID." };
    }

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, error: "Selected tab no longer exists." };
    }

    if (!isSupportedYouTubeTabUrl(tab.url)) {
      return {
        ok: false,
        error: "Only HTTPS YouTube tabs can be designated as a receiver.",
      };
    }

    cachedLastError = null;
    cachedPlayerSnapshot = null;
    suppressAutoDesignate = false;
    await saveStoredData({ designatedTabId: tabId });

    const state = await getReceiverState();
    return { ok: true, state };
  });
}

export async function clearDesignation(): Promise<CommandResult> {
  return withReceiverLock(async () => {
    cachedLastError = null;
    cachedPlayerSnapshot = null;
    suppressAutoDesignate = true;
    await saveStoredData({ designatedTabId: null });
    const state = await getReceiverState();
    return { ok: true, state };
  });
}

export async function focusDesignatedTab(): Promise<CommandResult> {
  const stored = await loadStoredData();
  if (stored.designatedTabId === null) {
    return { ok: false, error: "No receiver tab is designated." };
  }
  try {
    const tab = await chrome.tabs.update(stored.designatedTabId, { active: true });
    if (tab && typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    const state = await getReceiverState();
    return { ok: true, state };
  } catch {
    return { ok: false, error: "Designated tab could not be focused." };
  }
}

export async function closeDesignatedTab(): Promise<CommandResult> {
  return withReceiverLock(async () => {
    const stored = await loadStoredData();
    if (stored.designatedTabId === null) {
      return { ok: false, error: "No receiver tab is designated." };
    }
    const tabId = stored.designatedTabId;
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab may already be closed
    }
    cachedPlayerSnapshot = null;

    const remaining = await queryYouTubeTabs(null);
    const nextTab =
      remaining.length > 0 ? remaining[remaining.length - 1] : null;
    if (nextTab) {
      cachedLastError = null;
      suppressAutoDesignate = false;
      await saveStoredData({ designatedTabId: nextTab.tabId });
    } else {
      cachedLastError = "The designated YouTube tab was closed.";
      suppressAutoDesignate = true;
      await saveStoredData({ designatedTabId: null });
    }

    const state = await getReceiverState();
    return { ok: true, state };
  });
}

/**
 * Validates an HTTPS YouTube link and plays it in the designated receiver tab,
 * or creates and designates a new YouTube tab if none is currently valid.
 */
export async function playVideoUrl(rawUrl: string): Promise<CommandResult> {
  return withReceiverLock(async () => {
    const parsed = validateYouTubeVideoUrl(rawUrl);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    const stored = await loadStoredData();
    const { validTab } = await validateDesignatedTab(stored.designatedTabId);

    cachedLastError = null;

    if (validTab && typeof validTab.id === "number") {
      const currentVideoId = extractYouTubeVideoId(validTab.url);
      if (currentVideoId === parsed.videoId) {
        const playResult = await executeReceiverCommandUnlocked({ type: "PLAY" });
        const state = await getReceiverState();
        return {
          ok: playResult.ok,
          state,
          error: playResult.error,
          errorCode: playResult.errorCode,
        };
      }

      cachedPlayerSnapshot = null;
      try {
        await chrome.tabs.update(validTab.id, { url: parsed.canonicalUrl });
      } catch {
        cachedPlayerSnapshot = null;
        cachedLastError =
          "The designated YouTube tab was closed before the video could load.";
        await saveStoredData({ designatedTabId: null });
        const state = await getReceiverState();
        return {
          ok: false,
          state,
          error: cachedLastError,
        };
      }

      const state = await getReceiverState();
      return { ok: true, state };
    }

    // No valid designated receiver exists: create one YouTube tab and designate it.
    let created: chrome.tabs.Tab;
    try {
      created = await chrome.tabs.create({
        url: parsed.canonicalUrl,
        active: true,
      });
    } catch {
      cachedLastError = "Failed to create a YouTube receiver tab.";
      const state = await getReceiverState();
      return { ok: false, state, error: cachedLastError };
    }

    if (typeof created.id !== "number") {
      cachedLastError = "Failed to create a YouTube receiver tab.";
      const state = await getReceiverState();
      return { ok: false, state, error: cachedLastError };
    }

    cachedPlayerSnapshot = null;
    await saveStoredData({ designatedTabId: created.id });
    const state = await getReceiverState();
    return { ok: true, state };
  });
}

async function executeReceiverCommandUnlocked(
  rawCommand: PlaybackCommand,
): Promise<CommandResult> {
  const validation = validatePlaybackCommand(rawCommand);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const stored = await loadStoredData();
  const { validTab, invalidReason } = await validateDesignatedTab(
    stored.designatedTabId,
  );

  if (!validTab || typeof validTab.id !== "number") {
    if (stored.designatedTabId !== null) {
      await saveStoredData({ designatedTabId: null });
    }
    const state = await getReceiverState();
    return {
      ok: false,
      state,
      error: invalidReason ?? "Designate a YouTube tab first.",
    };
  }

  const result = await sendMessageToTab(validTab.id, {
    type: "EXECUTE_COMMAND",
    command: validation.command,
  });

  if (result.snapshot) {
    cachedPlayerSnapshot = result.snapshot;
  }
  cachedLastError = result.ok ? null : result.error ?? null;

  const state = await getReceiverState();
  return {
    ok: result.ok,
    state,
    snapshot: result.snapshot,
    error: result.error,
    errorCode: result.errorCode,
  };
}

/**
 * Isolated, validated command handler for playback control on the designated receiver.
 * Future remote-session flows can call this directly after session authorization.
 */
export async function executeReceiverCommand(
  rawCommand: PlaybackCommand,
): Promise<CommandResult> {
  return withReceiverLock(() => executeReceiverCommandUnlocked(rawCommand));
}

export async function handleContentSnapshot(
  senderTabId: number | undefined,
  snapshot: PlayerSnapshot,
): Promise<ReceiverState | null> {
  const stored = await loadStoredData();
  if (stored.designatedTabId === null || senderTabId !== stored.designatedTabId) {
    return null;
  }
  cachedPlayerSnapshot = snapshot;
  cachedLastError = snapshot.errorMessage ?? null;
  return getReceiverState();
}

export async function handleContentVideoEnded(
  senderTabId: number | undefined,
  videoId: string | null,
  endedAt: number,
): Promise<ReceiverState | null> {
  const stored = await loadStoredData();
  if (stored.designatedTabId === null || senderTabId !== stored.designatedTabId) {
    return null;
  }
  await saveStoredData({
    lastCompletedVideoId: videoId,
    lastCompletedAt: endedAt,
  });
  return getReceiverState();
}

export async function handleTabRemoved(tabId: number): Promise<boolean> {
  return withReceiverLock(async () => {
    const stored = await loadStoredData();
    if (stored.designatedTabId !== tabId) return false;
    cachedPlayerSnapshot = null;
    cachedLastError = "The designated YouTube tab was closed.";
    await saveStoredData({ designatedTabId: null });
    return true;
  });
}

export async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab?: chrome.tabs.Tab,
): Promise<boolean> {
  return withReceiverLock(async () => {
    const stored = await loadStoredData();
    if (stored.designatedTabId === tabId && changeInfo.url) {
      if (!isSupportedYouTubeTabUrl(changeInfo.url)) {
        cachedPlayerSnapshot = null;
        cachedLastError = "The designated tab navigated away from YouTube.";
        await saveStoredData({ designatedTabId: null });
        return true;
      }
      return true;
    }
    if (
      stored.designatedTabId === tabId &&
      (changeInfo.status !== undefined || changeInfo.title !== undefined)
    ) {
      return true;
    }
    // Also notify when any other YouTube tab opens, navigates, or finishes loading
    const url = changeInfo.url ?? tab?.url;
    if (
      isSupportedYouTubeTabUrl(url) &&
      (changeInfo.url !== undefined ||
        changeInfo.title !== undefined ||
        changeInfo.status === "complete")
    ) {
      return true;
    }
    return false;
  });
}
