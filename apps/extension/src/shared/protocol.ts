export type PlaybackCommand =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE_PLAY" }
  | { type: "SEEK_RELATIVE"; deltaSeconds: number }
  | { type: "SEEK_TO"; timeSeconds: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "NEXT_VIDEO" };

export type PlayerErrorCode =
  | "PLAYBACK_BLOCKED"
  | "MISSING_PLAYER"
  | "PLAYER_ERROR";

export interface PlayerSnapshot {
  status: "ready" | "loading" | "missing_player" | "error";
  videoId: string | null;
  title: string;
  url: string;
  isPlaying: boolean;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number | null;
  isLive: boolean;
  canSeek: boolean;
  volume: number;
  muted: boolean;
  playbackBlocked: boolean;
  errorCode?: PlayerErrorCode;
  errorMessage?: string;
  updatedAt: number;
}

export interface YouTubeTabInfo {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  audible: boolean;
  isDesignated: boolean;
}

export type ReceiverConnectionState =
  | "no_receiver"
  | "loading"
  | "connected"
  | "disconnected"
  | "missing_player";

export interface ReceiverState {
  designatedTabId: number | null;
  designatedTab: YouTubeTabInfo | null;
  availableTabs: YouTubeTabInfo[];
  connectionState: ReceiverConnectionState;
  player: PlayerSnapshot | null;
  lastError: string | null;
  lastCompletedVideoId: string | null;
  lastCompletedAt: number | null;
}

export interface PairedPhoneInfo {
  phoneId: string;
  phoneName: string;
  online: boolean;
}

export interface RemoteSessionInfo {
  sessionId: string;
  phoneId: string;
  phoneName: string;
  receiverId: string;
  status: "pending" | "active" | "denied" | "expired" | "revoked";
  createdAt: number;
  requestExpiresAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

export interface PendingPairingRequest {
  phoneId: string;
  phoneName: string;
  expiresAt: number;
}

export type RelayConnectionStatus =
  | "connecting"
  | "online"
  | "offline";

export interface RelayUiState {
  connectionStatus: RelayConnectionStatus;
  relayUrl: string;
  receiverId: string;
  deviceName: string;
  activePin: string | null;
  pinExpiresAt: number | null;
  pendingPairing: PendingPairingRequest | null;
  pairedPhones: PairedPhoneInfo[];
  favoritePhoneId: string | null;
  pendingSession: RemoteSessionInfo | null;
  activeSession: RemoteSessionInfo | null;
  lastSessionOutcome: "denied" | "expired" | "revoked" | null;
  lastRelayError: string | null;
  phoneAppUrl: string | null;
}

export type PopupToBackgroundMessage =
  | { type: "GET_STATE" }
  | { type: "DESIGNATE_TAB"; tabId: number }
  | { type: "CLEAR_DESIGNATION" }
  | { type: "PLAY_VIDEO_URL"; url: string }
  | { type: "PLAYER_COMMAND"; command: PlaybackCommand }
  | { type: "FOCUS_DESIGNATED_TAB" }
  | { type: "GET_RELAY_STATE" }
  | { type: "RELAY_RECONNECT" }
  | { type: "RELAY_SET_CONFIG"; deviceName?: string; relayUrl?: string }
  | { type: "RELAY_CREATE_PIN" }
  | { type: "RELAY_CONFIRM_PAIRING"; phoneId: string; approve: boolean }
  | { type: "RELAY_RESPOND_SESSION"; sessionId: string; approve: boolean }
  | { type: "RELAY_REVOKE_SESSION"; sessionId: string }
  | { type: "RELAY_REVOKE_PAIRING"; phoneId: string }
  | { type: "RELAY_SET_FAVORITE_PHONE"; phoneId: string | null };

export type BackgroundToContentMessage =
  | { type: "GET_PLAYER_STATE" }
  | { type: "EXECUTE_COMMAND"; command: PlaybackCommand };

export type ContentToBackgroundMessage =
  | { type: "PLAYER_STATE_CHANGED"; snapshot: PlayerSnapshot }
  | {
      type: "VIDEO_ENDED";
      videoId: string | null;
      title: string;
      endedAt: number;
    };

export type BackgroundToPopupEvent =
  | { type: "RECEIVER_STATE_UPDATED"; state: ReceiverState }
  | { type: "RELAY_STATE_UPDATED"; relayState: RelayUiState };

export interface CommandResult {
  ok: boolean;
  state?: ReceiverState;
  relayState?: RelayUiState;
  snapshot?: PlayerSnapshot;
  error?: string;
  errorCode?: string;
}

const VALID_COMMAND_TYPES = new Set<PlaybackCommand["type"]>([
  "PLAY",
  "PAUSE",
  "TOGGLE_PLAY",
  "SEEK_RELATIVE",
  "SEEK_TO",
  "SET_VOLUME",
  "SET_MUTED",
]);

/**
 * Validates and normalizes an incoming playback command before execution.
 * Shared by the local popup flow and future remote-session command handlers.
 */
export function validatePlaybackCommand(
  raw: unknown,
): { ok: true; command: PlaybackCommand } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid playback command payload." };
  }

  const candidate = raw as Record<string, unknown>;
  const type = candidate.type;

  if (typeof type !== "string" || !VALID_COMMAND_TYPES.has(type as PlaybackCommand["type"])) {
    return { ok: false, error: "Unsupported playback command type." };
  }

  switch (type) {
    case "PLAY":
    case "PAUSE":
    case "TOGGLE_PLAY":
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

/**
 * Validates that a runtime message comes from this extension's own ID.
 */
export function isTrustedExtensionSender(
  sender: chrome.runtime.MessageSender,
  ownExtensionId: string,
): boolean {
  return sender.id === ownExtensionId;
}
