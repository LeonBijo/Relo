import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// Set up minimal Chrome extension API mocks before importing receiverService
const storageData: Record<string, unknown> = {};
let tabsList: chrome.tabs.Tab[] = [];
let nextTabId = 100;
let createShouldFailOnce = false;
let updateShouldFailOnce: ((tabId: number) => void) | null = null;

function resetMocks() {
  for (const key of Object.keys(storageData)) {
    delete storageData[key];
  }
  tabsList = [];
  nextTabId = 100;
  createShouldFailOnce = false;
  updateShouldFailOnce = null;
}

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
  tabs: {
    async query() {
      return tabsList.filter((t) =>
        t.url?.startsWith("https://www.youtube.com/"),
      );
    },
    async get(tabId: number) {
      const found = tabsList.find((t) => t.id === tabId);
      if (!found) throw new Error("No tab with id");
      return found;
    },
    async create(props: chrome.tabs.CreateProperties) {
      if (createShouldFailOnce) {
        createShouldFailOnce = false;
        throw new Error("Tab creation failed");
      }
      const created: chrome.tabs.Tab = {
        id: nextTabId++,
        windowId: 1,
        index: tabsList.length,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        discarded: false,
        frozen: false,
        autoDiscardable: true,
        groupId: -1,
        active: Boolean(props.active),
        audible: false,
        url: props.url,
        title: "YouTube",
        status: "complete",
      };
      tabsList.push(created);
      return created;
    },
    async update(tabId: number, props: chrome.tabs.UpdateProperties) {
      if (updateShouldFailOnce) {
        const hook = updateShouldFailOnce;
        updateShouldFailOnce = null;
        hook(tabId);
        throw new Error("No tab with id");
      }
      const tab = tabsList.find((t) => t.id === tabId);
      if (!tab) throw new Error("No tab with id");
      if (props.url !== undefined) tab.url = props.url;
      if (props.active !== undefined) tab.active = props.active;
      return tab;
    },
    async sendMessage(tabId: number) {
      const tab = tabsList.find((t) => t.id === tabId);
      if (!tab) throw new Error("No tab");
      return {
        ok: true,
        snapshot: {
          status: "ready",
          videoId: "dQw4w9WgXcQ",
          title: tab.title ?? "YouTube",
          url: tab.url ?? "https://www.youtube.com/",
          isPlaying: true,
          paused: false,
          ended: false,
          currentTime: 10,
          duration: 212,
          isLive: false,
          canSeek: true,
          volume: 80,
          muted: false,
          playbackBlocked: false,
          updatedAt: Date.now(),
        },
      };
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
  clearDesignation,
  designateYouTubeTab,
  getReceiverState,
  handleContentSnapshot,
  handleTabRemoved,
  handleTabUpdated,
  playVideoUrl,
} = await import("../src/background/receiverService.ts");

describe("receiverService routing and designation", () => {
  beforeEach(async () => {
    resetMocks();
    await clearDesignation();
  });

  it("creates and designates a YouTube tab on Play video, then reuses it on subsequent links", async () => {
    const unrelatedTab: chrome.tabs.Tab = {
      id: 1,
      windowId: 1,
      index: 0,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: true,
      audible: false,
      url: "https://example.com/",
      title: "Example",
    };
    tabsList.push(unrelatedTab);

    const first = await playVideoUrl("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(first.ok, true);
    assert.equal(first.state?.designatedTabId, 100);
    assert.equal(tabsList.length, 2);
    assert.equal(
      tabsList[1].url,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );

    const second = await playVideoUrl(
      "https://www.youtube.com/shorts/9bZkp7q19f0",
    );
    assert.equal(second.ok, true);
    assert.equal(second.state?.designatedTabId, 100);
    assert.equal(tabsList.length, 2);
    assert.equal(
      tabsList[1].url,
      "https://www.youtube.com/watch?v=9bZkp7q19f0",
    );
    assert.equal(unrelatedTab.url, "https://example.com/");
  });

  it("rejects non-YouTube tabs and clears designation on close or navigation away", async () => {
    tabsList.push({
      id: 50,
      windowId: 1,
      index: 0,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: true,
      audible: false,
      url: "https://example.com/",
      title: "Example",
    });

    const bad = await designateYouTubeTab(50);
    assert.equal(bad.ok, false);

    tabsList.push({
      id: 51,
      windowId: 1,
      index: 1,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: false,
      audible: false,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Demo Video - YouTube",
      status: "complete",
    });

    const good = await designateYouTubeTab(51);
    assert.equal(good.ok, true);
    assert.equal(good.state?.designatedTabId, 51);

    // Non-designated tab snapshot is ignored
    const ignored = await handleContentSnapshot(52, {
      status: "ready",
      videoId: "other123456",
      title: "Other",
      url: "https://www.youtube.com/watch?v=other123456",
      isPlaying: true,
      paused: false,
      ended: false,
      currentTime: 0,
      duration: 60,
      isLive: false,
      canSeek: true,
      volume: 100,
      muted: false,
      playbackBlocked: false,
      updatedAt: Date.now(),
    });
    assert.equal(ignored, null);

    // Navigating away from YouTube clears designation
    tabsList[1].url = "https://news.ycombinator.com/";
    const navigated = await handleTabUpdated(51, {
      url: "https://news.ycombinator.com/",
    });
    assert.equal(navigated, true);
    const stateAfterNav = await getReceiverState();
    assert.equal(stateAfterNav.designatedTabId, null);

    // Re-designate and close tab
    tabsList[1].url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await designateYouTubeTab(51);
    tabsList = tabsList.filter((t) => t.id !== 51);
    const removed = await handleTabRemoved(51);
    assert.equal(removed, true);
    const stateAfterClose = await getReceiverState();
    assert.equal(stateAfterClose.designatedTabId, null);
  });

  it("auto-designates when exactly one YouTube tab is open, and waits for choice when multiple are open", async () => {
    tabsList.push({
      id: 81,
      windowId: 1,
      index: 0,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: true,
      audible: false,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Solo Video - YouTube",
      status: "complete",
    });

    const singleState = await getReceiverState();
    assert.equal(singleState.designatedTabId, 81);
    assert.equal(singleState.connectionState, "connected");

    // Clear and add a second YouTube tab -> should NOT auto-pick between two tabs
    await clearDesignation();
    tabsList.push({
      id: 82,
      windowId: 1,
      index: 1,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: false,
      audible: false,
      url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      title: "Second Video - YouTube",
      status: "complete",
    });

    const multiState = await getReceiverState();
    assert.equal(multiState.designatedTabId, null);
    assert.equal(multiState.availableTabs.length, 2);
  });

  it("serializes concurrent initial playVideoUrl calls to create only one tab and does not block after failure", async () => {
    const [first, second] = await Promise.all([
      playVideoUrl("https://youtu.be/dQw4w9WgXcQ"),
      playVideoUrl("https://www.youtube.com/watch?v=9bZkp7q19f0"),
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(tabsList.length, 1);
    assert.equal(first.state?.designatedTabId, 100);
    assert.equal(second.state?.designatedTabId, 100);
    assert.equal(
      tabsList[0].url,
      "https://www.youtube.com/watch?v=9bZkp7q19f0",
    );

    // Clear and simulate a failed operation followed by a valid operation
    await clearDesignation();
    tabsList = [];
    createShouldFailOnce = true;

    const failed = await playVideoUrl("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(failed.ok, false);
    assert.ok(failed.error);

    const recovered = await playVideoUrl("https://youtu.be/9bZkp7q19f0");
    assert.equal(recovered.ok, true);
    assert.equal(tabsList.length, 1);
    assert.equal(recovered.state?.designatedTabId, 101);
  });

  it("recovers receiver state and returns failed CommandResult when chrome.tabs.update rejects because tab closed", async () => {
    tabsList.push({
      id: 77,
      windowId: 1,
      index: 0,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      active: false,
      audible: false,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Initial Video - YouTube",
      status: "complete",
    });

    await designateYouTubeTab(77);

    // Simulate tab closing right after validation, causing chrome.tabs.update to reject
    updateShouldFailOnce = (tabId) => {
      tabsList = tabsList.filter((t) => t.id !== tabId);
    };

    const result = await playVideoUrl(
      "https://www.youtube.com/watch?v=9bZkp7q19f0",
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /closed/i);
    assert.equal(result.state?.designatedTabId, null);
    assert.equal(result.state?.connectionState, "no_receiver");
    assert.match(result.state?.lastError ?? "", /closed/i);
  });
});
