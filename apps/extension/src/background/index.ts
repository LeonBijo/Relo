import {
  type BackgroundToPopupEvent,
  type CommandResult,
  type ContentToBackgroundMessage,
  type PopupToBackgroundMessage,
  isTrustedExtensionSender,
} from "../shared/protocol";
import {
  clearDesignation,
  designateYouTubeTab,
  executeReceiverCommand,
  focusDesignatedTab,
  getReceiverState,
  handleContentSnapshot,
  handleContentVideoEnded,
  handleTabRemoved,
  handleTabUpdated,
  playVideoUrl,
} from "./receiverService";

import {
  confirmPairingRequest,
  createPairingPin,
  ensureRelayConnected,
  getRelayUiState,
  handleRelayAlarm,
  initRelayClient,
  pushReceiverStateToRelay,
  respondToSessionRequest,
  revokeActiveSession,
  revokePairedPhone,
  setFavoritePhone,
  setRelayConfig,
} from "./relayClient.ts";

void initRelayClient();

function broadcastState(state: Awaited<ReturnType<typeof getReceiverState>>) {
  pushReceiverStateToRelay(state);
  const event: BackgroundToPopupEvent = {
    type: "RECEIVER_STATE_UPDATED",
    state,
  };
  chrome.runtime.sendMessage(event).catch(() => {
    // Popup is not open; safe to ignore.
  });
}

async function broadcastCurrentState() {
  const state = await getReceiverState();
  broadcastState(state);
}

function toErrorResponse(err: unknown): CommandResult {
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Unexpected receiver error.",
  };
}

function respondAsync(
  promise: Promise<CommandResult>,
  sendResponse: (response: CommandResult) => void,
  broadcastOnState = false,
) {
  promise
    .then((res) => {
      if (broadcastOnState && res.state) {
        broadcastState(res.state);
      }
      sendResponse(res);
    })
    .catch((err) => {
      sendResponse(toErrorResponse(err));
    });
}

chrome.runtime.onMessage.addListener(
  (
    message: PopupToBackgroundMessage | ContentToBackgroundMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: CommandResult) => void,
  ) => {
    if (!isTrustedExtensionSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: "Untrusted message sender." });
      return false;
    }

    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      sendResponse({ ok: false, error: "Invalid message payload." });
      return false;
    }

    // Content script -> Background events (only accepted from designated tab)
    if (message.type === "PLAYER_STATE_CHANGED") {
      handleContentSnapshot(sender.tab?.id, message.snapshot)
        .then((state) => {
          if (state) broadcastState(state);
          sendResponse({ ok: true });
        })
        .catch((err) => sendResponse(toErrorResponse(err)));
      return true;
    }

    if (message.type === "VIDEO_ENDED") {
      handleContentVideoEnded(
        sender.tab?.id,
        message.videoId,
        message.endedAt,
      )
        .then((state) => {
          if (state) broadcastState(state);
          sendResponse({ ok: true });
        })
        .catch((err) => sendResponse(toErrorResponse(err)));
      return true;
    }

    // Popup -> Background commands (reject messages coming from web content scripts)
    if (sender.tab) {
      sendResponse({
        ok: false,
        error: "Receiver control commands are not permitted from web tabs.",
      });
      return false;
    }

    switch (message.type) {
      case "GET_STATE":
        respondAsync(
          getReceiverState().then((state) => ({ ok: true, state })),
          sendResponse,
        );
        return true;

      case "DESIGNATE_TAB":
        respondAsync(designateYouTubeTab(message.tabId), sendResponse, true);
        return true;

      case "CLEAR_DESIGNATION":
        respondAsync(clearDesignation(), sendResponse, true);
        return true;

      case "FOCUS_DESIGNATED_TAB":
        respondAsync(focusDesignatedTab(), sendResponse);
        return true;

      case "PLAY_VIDEO_URL":
        respondAsync(playVideoUrl(message.url), sendResponse, true);
        return true;

      case "PLAYER_COMMAND":
        respondAsync(executeReceiverCommand(message.command), sendResponse, true);
        return true;

      case "GET_RELAY_STATE":
        respondAsync(
          getRelayUiState().then((relayState) => ({ ok: true, relayState })),
          sendResponse,
        );
        return true;

      case "RELAY_RECONNECT":
        respondAsync(
          ensureRelayConnected(true).then(() =>
            getRelayUiState().then((relayState) => ({
              ok: relayState.connectionStatus === "online",
              relayState,
              error:
                relayState.connectionStatus === "online"
                  ? undefined
                  : relayState.lastRelayError ?? "Relay is still offline.",
            })),
          ),
          sendResponse,
        );
        return true;

      case "RELAY_SET_CONFIG":
        respondAsync(
          setRelayConfig(message.deviceName, message.relayUrl),
          sendResponse,
        );
        return true;

      case "RELAY_CREATE_PIN":
        respondAsync(createPairingPin(), sendResponse);
        return true;

      case "RELAY_CONFIRM_PAIRING":
        respondAsync(
          confirmPairingRequest(message.phoneId, message.approve),
          sendResponse,
        );
        return true;

      case "RELAY_RESPOND_SESSION":
        respondAsync(
          respondToSessionRequest(message.sessionId, message.approve),
          sendResponse,
        );
        return true;

      case "RELAY_REVOKE_SESSION":
        respondAsync(revokeActiveSession(message.sessionId), sendResponse);
        return true;

      case "RELAY_REVOKE_PAIRING":
        respondAsync(revokePairedPhone(message.phoneId), sendResponse);
        return true;

      case "RELAY_SET_FAVORITE_PHONE":
        respondAsync(setFavoritePhone(message.phoneId), sendResponse);
        return true;

      default:
        sendResponse({ ok: false, error: "Unknown command." });
        return false;
    }
  },
);

chrome.alarms?.onAlarm.addListener((alarm) => {
  void handleRelayAlarm(alarm.name);
});

chrome.tabs.onCreated.addListener(() => {
  void broadcastCurrentState();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId).then(() => {
    void broadcastCurrentState();
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  handleTabUpdated(tabId, changeInfo, tab).then((changed) => {
    if (changed) void broadcastCurrentState();
  });
});
