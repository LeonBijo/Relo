import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import logo from "@/assets/relo-icon-48.png";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/shared/format";
import {
  type BackgroundToPopupEvent,
  type CommandResult,
  type PlaybackCommand,
  type PopupToBackgroundMessage,
  type ReceiverConnectionState,
  type ReceiverState,
  type RelayUiState,
} from "@/shared/protocol";
import { validateYouTubeVideoUrl } from "@/shared/youtubeUrl";

const CONNECTION_META: Record<
  ReceiverConnectionState,
  { label: string; colorClass: string }
> = {
  connected: { label: "Connected", colorClass: "text-[#72dfaa]" },
  loading: { label: "Loading", colorClass: "text-[#f6cc76]" },
  missing_player: { label: "No player", colorClass: "text-[#f6cc76]" },
  disconnected: { label: "Disconnected", colorClass: "text-destructive" },
  no_receiver: { label: "No tab", colorClass: "text-muted-foreground" },
};

async function sendToBackground(
  message: PopupToBackgroundMessage,
): Promise<CommandResult> {
  return (await chrome.runtime.sendMessage(message)) as CommandResult;
}

function SeekButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "back" | "forward";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "back" ? RotateCcw : RotateCw;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative size-12 rounded-full"
      disabled={disabled}
      onClick={onClick}
      aria-label={
        direction === "back" ? "Rewind ten seconds" : "Forward ten seconds"
      }
    >
      <Icon className="size-7" />
      <span
        aria-hidden="true"
        className="absolute top-[20px] left-[19px] text-[8px] leading-none font-bold"
      >
        10
      </span>
    </Button>
  );
}

export function App() {
  const [receiver, setReceiver] = useState<ReceiverState | null>(null);
  const [relay, setRelay] = useState<RelayUiState | null>(null);
  const [activeTab, setActiveTab] = useState("receiver");
  const [showSettings, setShowSettings] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [deviceNameInput, setDeviceNameInput] = useState("My Desktop");
  const [relayUrlInput, setRelayUrlInput] = useState("ws://localhost:8787/ws");
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);
  const [isRelayBusy, setIsRelayBusy] = useState(false);
  const [copiedPhoneUrl, setCopiedPhoneUrl] = useState(false);

  // Local slider drag state so periodic playback updates do not fight user scrubbing
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const [rxRes, relayRes] = await Promise.all([
        sendToBackground({ type: "GET_STATE" }),
        sendToBackground({ type: "GET_RELAY_STATE" }),
      ]);
      if (rxRes?.ok && rxRes.state) {
        setReceiver(rxRes.state);
      }
      if (relayRes?.ok && relayRes.relayState) {
        setRelay(relayRes.relayState);
        setDeviceNameInput((prev) => prev || relayRes.relayState!.deviceName);
        setRelayUrlInput((prev) => prev || relayRes.relayState!.relayUrl);
      }
    } catch {
      setActionError("Unable to communicate with the extension service worker.");
    }
  }, []);

  useEffect(() => {
    void refreshState();

    const onMessage = (message: BackgroundToPopupEvent) => {
      if (message?.type === "RECEIVER_STATE_UPDATED" && message.state) {
        setReceiver(message.state);
      } else if (message?.type === "RELAY_STATE_UPDATED" && message.relayState) {
        setRelay(message.relayState);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [refreshState]);

  useEffect(() => {
    if (!relay?.pinExpiresAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [relay?.pinExpiresAt]);

  async function runRelayAction(message: PopupToBackgroundMessage) {
    setActionError(null);
    setSettingsSavedMsg(null);
    setIsRelayBusy(true);
    try {
      const res = await sendToBackground(message);
      if (res.relayState) setRelay(res.relayState);
      if (!res.ok && res.error) {
        setActionError(res.error);
      }
      return res;
    } catch {
      const errMsg = "Unable to reach the extension service worker.";
      setActionError(errMsg);
      return { ok: false, error: errMsg } satisfies CommandResult;
    } finally {
      setIsRelayBusy(false);
    }
  }

  async function runCommand(command: PlaybackCommand) {
    setActionError(null);
    try {
      const res = await sendToBackground({ type: "PLAYER_COMMAND", command });
      if (res.state) setReceiver(res.state);
      if (!res.ok && res.error) {
        setActionError(res.error);
      }
    } catch {
      setActionError("Command failed. Try refreshing the receiver state.");
    }
  }

  async function handleSelectTab(value: string) {
    const tabId = Number(value);
    if (!Number.isInteger(tabId)) return;
    setActionError(null);
    setIsBusy(true);
    try {
      const res = await sendToBackground({ type: "DESIGNATE_TAB", tabId });
      if (res.state) setReceiver(res.state);
      if (!res.ok && res.error) setActionError(res.error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClearDesignation() {
    setActionError(null);
    const res = await sendToBackground({ type: "CLEAR_DESIGNATION" });
    if (res.state) setReceiver(res.state);
  }

  async function handlePlayLink(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);

    const validation = validateYouTubeVideoUrl(linkInput);
    if (!validation.ok) {
      setLinkError(validation.error);
      return;
    }

    setLinkError(null);
    setIsBusy(true);
    try {
      const res = await sendToBackground({
        type: "PLAY_VIDEO_URL",
        url: linkInput,
      });
      if (res.state) setReceiver(res.state);
      if (!res.ok) {
        setActionError(res.error ?? "Unable to play video on the receiver.");
      } else {
        setLinkInput("");
      }
    } catch {
      setActionError("Unable to reach the extension service worker.");
    } finally {
      setIsBusy(false);
    }
  }

  const connectionState = receiver?.connectionState ?? "no_receiver";
  const connectionMeta = CONNECTION_META[connectionState];
  const player = receiver?.player ?? null;
  const availableTabs = receiver?.availableTabs ?? [];

  const hasReadyPlayer =
    connectionState === "connected" &&
    player !== null &&
    player.status !== "missing_player";

  const duration = player?.duration ?? null;
  const displayTime = seekPreview ?? player?.currentTime ?? 0;
  const displayVolume =
    volumePreview ?? (player?.muted ? 0 : (player?.volume ?? 100));

  const feedbackMessage =
    actionError ??
    (player?.playbackBlocked ? player.errorMessage : null) ??
    receiver?.lastError ??
    null;

  let playbackStatusText = "No video loaded";
  if (connectionState === "loading") {
    playbackStatusText = "Loading YouTube tab…";
  } else if (connectionState === "missing_player") {
    playbackStatusText = "No active player on this tab";
  } else if (connectionState === "disconnected") {
    playbackStatusText = "Receiver disconnected";
  } else if (player) {
    if (player.playbackBlocked) {
      playbackStatusText = "Playback blocked — click Play on YouTube";
    } else if (player.ended) {
      playbackStatusText = "Completed";
    } else if (player.isPlaying) {
      playbackStatusText = player.isLive ? "Playing · Live" : "Playing";
    } else {
      playbackStatusText = player.isLive ? "Paused · Live" : "Paused";
    }
  }

  const pinRemainingSec =
    relay?.pinExpiresAt && relay.pinExpiresAt > nowMs
      ? Math.ceil((relay.pinExpiresAt - nowMs) / 1000)
      : 0;

  let phoneBadgeLabel = "Offline";
  let phoneBadgeClass = "text-muted-foreground";
  if (relay?.connectionStatus === "online") {
    if (relay.activeSession) {
      phoneBadgeLabel = "Authorized";
      phoneBadgeClass = "text-[#72dfaa]";
    } else if (relay.pendingSession) {
      phoneBadgeLabel = "Approval pending";
      phoneBadgeClass = "text-[#f6cc76]";
    } else if (relay.lastSessionOutcome === "denied") {
      phoneBadgeLabel = "Request denied";
      phoneBadgeClass = "text-destructive";
    } else if (relay.lastSessionOutcome === "expired") {
      phoneBadgeLabel = "Session expired";
      phoneBadgeClass = "text-muted-foreground";
    } else {
      phoneBadgeLabel = "Online";
      phoneBadgeClass = "text-[#72dfaa]";
    }
  } else if (relay?.connectionStatus === "connecting") {
    phoneBadgeLabel = "Connecting";
    phoneBadgeClass = "text-[#f6cc76]";
  }

  return (
    <div className="w-[360px] bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <img src={logo} className="size-7" alt="RELO" />
          <span className="text-base font-bold tracking-[0.2em]">RELO</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={`gap-1.5 px-2 py-0.5 text-[11px] ${phoneBadgeClass}`}
            title="Relay / Phone status"
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {phoneBadgeLabel}
          </Badge>
          <Badge
            variant="outline"
            className={`gap-1.5 px-2 py-0.5 text-[11px] ${connectionMeta.colorClass}`}
            title="YouTube tab status"
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {connectionMeta.label}
          </Badge>
          <Button
            type="button"
            variant={showSettings ? "secondary" : "ghost"}
            size="icon"
            className="size-8 shrink-0"
            aria-label={showSettings ? "Close settings" : "Open settings"}
            title={showSettings ? "Close settings" : "Settings"}
            onClick={() => setShowSettings((prev) => !prev)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </header>

      <main className="p-4">
        {showSettings ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={() => setShowSettings(false)}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <span className="text-sm font-semibold">Settings</span>
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="space-y-2">
                <Label htmlFor="device-name-input" className="text-xs">
                  Desktop name
                </Label>
                <Input
                  id="device-name-input"
                  className="min-h-10"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  placeholder="My Desktop"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="relay-url-input" className="text-xs">
                  Relay WebSocket URL
                </Label>
                <Input
                  id="relay-url-input"
                  className="min-h-10 font-mono text-xs"
                  value={relayUrlInput}
                  onChange={(e) => setRelayUrlInput(e.target.value)}
                  placeholder="ws://localhost:8787/ws"
                />
              </div>

              <Button
                type="button"
                className="min-h-10 w-full"
                disabled={isRelayBusy}
                onClick={async () => {
                  const res = await runRelayAction({
                    type: "RELAY_SET_CONFIG",
                    deviceName: deviceNameInput,
                    relayUrl: relayUrlInput,
                  });
                  if (res.ok && res.relayState?.connectionStatus === "online") {
                    setSettingsSavedMsg("Connected and settings saved.");
                  }
                }}
              >
                {isRelayBusy ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Save & connect"
                )}
              </Button>
              {settingsSavedMsg && (
                <p className="text-xs text-[#72dfaa]">{settingsSavedMsg}</p>
              )}
              {(actionError || relay?.lastRelayError) && (
                <p role="alert" className="text-xs text-destructive">
                  {actionError ?? relay?.lastRelayError}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
              <WifiOff className="mt-0.5 size-4 shrink-0" />
              <span>
                Every new remote session requires explicit desktop approval.
              </span>
            </div>
          </div>
        ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0">
            <TabsTrigger
              value="receiver"
              className="min-h-9 rounded-lg border border-border text-xs data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Controls
            </TabsTrigger>
            <TabsTrigger
              value="phone"
              className="relative min-h-9 rounded-lg border border-border text-xs data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Phone
              {(relay?.pendingPairing || relay?.pendingSession) && (
                <span className="ml-1.5 size-1.5 rounded-full bg-[#f6cc76]" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="receiver" className="mt-0 space-y-4">
            {relay?.activeSession && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#72dfaa]">
                    {relay.activeSession.phoneName} connected
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Can load links and control playback
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() =>
                    void runRelayAction({
                      type: "RELAY_REVOKE_SESSION",
                      sessionId: relay.activeSession!.sessionId,
                    })
                  }
                >
                  End access
                </Button>
              </div>
            )}

            {relay?.pendingSession && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#f6cc76]/50 bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#f6cc76]">
                    {relay.pendingSession.phoneName} requests control
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Review in the Approve tab
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => setActiveTab("phone")}
                >
                  Review
                </Button>
              </div>
            )}
        {/* Designated YouTube Tab Picker */}
        <section className="space-y-2.5" aria-label="Designated YouTube tab">
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="youtube-tab-select"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Monitor className="size-4 text-muted-foreground" />
              Designated YouTube tab
            </Label>
            <div className="flex items-center gap-1">
              {receiver?.designatedTabId !== null &&
                receiver?.designatedTabId !== undefined && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title="Focus designated YouTube tab"
                      aria-label="Focus designated YouTube tab"
                      onClick={() =>
                        void sendToBackground({ type: "FOCUS_DESIGNATED_TAB" })
                      }
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title="Clear tab designation"
                      aria-label="Clear tab designation"
                      onClick={() => void handleClearDesignation()}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                title="Refresh YouTube tabs"
                aria-label="Refresh YouTube tabs"
                onClick={() => void refreshState()}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>

          {availableTabs.length > 0 ? (
            <Select
              value={
                receiver?.designatedTabId !== null &&
                receiver?.designatedTabId !== undefined
                  ? String(receiver.designatedTabId)
                  : ""
              }
              onValueChange={(value) => void handleSelectTab(value)}
              disabled={isBusy}
            >
              <SelectTrigger id="youtube-tab-select" className="min-h-11 w-full">
                <SelectValue placeholder="Choose a YouTube tab…" />
              </SelectTrigger>
              <SelectContent>
                {availableTabs.map((tab) => {
                  const tags = [
                    tab.active ? "Active" : null,
                    tab.audible ? "Audio" : null,
                    `#${tab.tabId}`,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <SelectItem key={tab.tabId} value={String(tab.tabId)}>
                      <span className="flex max-w-[265px] flex-col text-left">
                        <span className="truncate font-medium">{tab.title}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {tags}
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <p className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
              No YouTube tabs are open. Paste a link below to open and designate
              one automatically.
            </p>
          )}
        </section>

        {/* Video Link Input */}
        <form onSubmit={handlePlayLink} className="space-y-2.5">
          <Label htmlFor="youtube-link-input" className="text-sm font-semibold">
            YouTube video link
          </Label>
          <div className="flex gap-2">
            <Input
              id="youtube-link-input"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              className="min-h-11 flex-1"
              value={linkInput}
              onChange={(e) => {
                setLinkInput(e.target.value);
                if (linkError) setLinkError(null);
              }}
              aria-invalid={Boolean(linkError)}
            />
            <Button
              type="submit"
              className="min-h-11 shrink-0 px-4"
              disabled={isBusy}
            >
              {isBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                "Play video"
              )}
            </Button>
          </div>
          {linkError && (
            <p role="alert" className="text-xs leading-5 text-destructive">
              {linkError}
            </p>
          )}
        </form>

        {/* Feedback / Error Banner */}
        {feedbackMessage && (
          <Alert
            variant={
              player?.playbackBlocked || connectionState === "disconnected"
                ? "destructive"
                : "default"
            }
            className="border-border bg-card py-2.5"
          >
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs leading-5">
              {feedbackMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Local Receiver-Test Area */}
        <section
          aria-label="Local receiver test controls"
          className="space-y-4 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Local receiver test
            </span>
            <span className="text-xs text-muted-foreground">
              {playbackStatusText}
            </span>
          </div>

          {/* Current Video Title */}
          <div className="space-y-0.5">
            <p className="truncate text-sm font-semibold leading-5">
              {player?.title ??
                receiver?.designatedTab?.title ??
                "No designated video"}
            </p>
            {player?.ended && player.videoId && (
              <p className="text-xs text-[#72dfaa]">
                Video completed · Ready for next queued item
              </p>
            )}
          </div>

          {/* Seek Slider */}
          <div className="space-y-2">
            <Slider
              id="receiver-seek-slider"
              aria-label="Playback position"
              className="min-h-6"
              disabled={!hasReadyPlayer || !player?.canSeek || duration === null}
              min={0}
              max={duration && duration > 0 ? duration : 100}
              step={1}
              value={[
                duration && duration > 0
                  ? Math.min(displayTime, duration)
                  : 0,
              ]}
              onValueChange={(vals) => setSeekPreview(vals[0])}
              onValueCommit={(vals) => {
                setSeekPreview(null);
                void runCommand({ type: "SEEK_TO", timeSeconds: vals[0] });
              }}
            />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{hasReadyPlayer ? formatTime(displayTime) : "—"}</span>
              <span>
                {!hasReadyPlayer
                  ? "—"
                  : player?.isLive
                    ? "Live"
                    : duration !== null
                      ? formatTime(duration)
                      : "Unavailable"}
              </span>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center justify-center gap-3">
            <SeekButton
              direction="back"
              disabled={!hasReadyPlayer || !player?.canSeek}
              onClick={() =>
                void runCommand({ type: "SEEK_RELATIVE", deltaSeconds: -10 })
              }
            />
            <Button
              type="button"
              size="icon"
              className="size-14 rounded-full"
              disabled={!hasReadyPlayer}
              aria-label={player?.isPlaying ? "Pause" : "Play"}
              onClick={() => void runCommand({ type: "TOGGLE_PLAY" })}
            >
              {player?.isPlaying ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6" />
              )}
            </Button>
            <SeekButton
              direction="forward"
              disabled={!hasReadyPlayer || !player?.canSeek}
              onClick={() =>
                void runCommand({ type: "SEEK_RELATIVE", deltaSeconds: 10 })
              }
            />
          </div>

          {/* Volume & Mute */}
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              disabled={!hasReadyPlayer}
              aria-label={player?.muted ? "Unmute" : "Mute"}
              aria-pressed={Boolean(player?.muted)}
              onClick={() =>
                void runCommand({
                  type: "SET_MUTED",
                  muted: !player?.muted,
                })
              }
            >
              {player?.muted || displayVolume === 0 ? (
                <VolumeX className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
            </Button>
            <Slider
              aria-label="Desktop volume"
              className="min-h-6 flex-1"
              disabled={!hasReadyPlayer}
              min={0}
              max={100}
              step={1}
              value={[displayVolume]}
              onValueChange={(vals) => setVolumePreview(vals[0])}
              onValueCommit={(vals) => {
                setVolumePreview(null);
                void runCommand({ type: "SET_VOLUME", volume: vals[0] });
              }}
            />
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {hasReadyPlayer ? `${displayVolume}%` : "—"}
            </span>
          </div>
        </section>
          </TabsContent>

          <TabsContent value="phone" className="mt-0 space-y-4">
            {/* Session Approval / Active Control */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="size-4" />
                  Remote session
                </span>
                <Badge variant="outline" className={`text-xs ${phoneBadgeClass}`}>
                  {phoneBadgeLabel}
                </Badge>
              </div>

              {relay?.pendingSession ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-base font-semibold">
                      Allow {relay.pendingSession.phoneName}?
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      This phone is requesting playback control of{" "}
                      {relay.deviceName}.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      className="min-h-11"
                      onClick={() =>
                        void runRelayAction({
                          type: "RELAY_RESPOND_SESSION",
                          sessionId: relay.pendingSession!.sessionId,
                          approve: true,
                        })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() =>
                        void runRelayAction({
                          type: "RELAY_RESPOND_SESSION",
                          sessionId: relay.pendingSession!.sessionId,
                          approve: false,
                        })
                      }
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              ) : relay?.activeSession ? (
                <div className="space-y-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {relay.activeSession.phoneName}
                    </span>{" "}
                    is authorized to send YouTube links and control playback.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() =>
                      void runRelayAction({
                        type: "RELAY_REVOKE_SESSION",
                        sessionId: relay.activeSession!.sessionId,
                      })
                    }
                  >
                    End phone access
                  </Button>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  {relay?.lastSessionOutcome === "denied"
                    ? "The last control request was denied. A paired phone must send a new request."
                    : relay?.lastSessionOutcome === "revoked"
                      ? "Phone access was ended. A fresh approval is required for the next session."
                      : relay?.lastSessionOutcome === "expired"
                        ? "The previous session expired. A fresh approval is required."
                        : "No active session. Pair a phone below, then tap Request control on the phone."}
                </p>
              )}
            </div>

            {/* Pairing & First-Time Confirmation */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Smartphone className="size-4" />
                Pair a phone
              </div>

              {relay?.connectionStatus !== "online" ? (
                <div className="space-y-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Relay is offline. Reconnect or check Settings to generate a
                    pairing PIN.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full"
                    disabled={isRelayBusy}
                    onClick={() => void runRelayAction({ type: "RELAY_RECONNECT" })}
                  >
                    {isRelayBusy ? "Connecting…" : "Retry connection"}
                  </Button>
                </div>
              ) : relay.pendingPairing ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      Pair {relay.pendingPairing.phoneName}?
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Confirm this is the phone that entered your pairing PIN.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      className="min-h-11"
                      onClick={() =>
                        void runRelayAction({
                          type: "RELAY_CONFIRM_PAIRING",
                          phoneId: relay.pendingPairing!.phoneId,
                          approve: true,
                        })
                      }
                    >
                      Confirm pairing
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() =>
                        void runRelayAction({
                          type: "RELAY_CONFIRM_PAIRING",
                          phoneId: relay.pendingPairing!.phoneId,
                          approve: false,
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : relay.activePin && pinRemainingSec > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Enter this single-use code in RELO on your phone.
                  </p>
                  <div className="rounded-lg border border-border bg-background px-4 py-3 text-center">
                    <p
                      aria-label={`Pairing PIN ${relay.activePin.split("").join(" ")}`}
                      className="font-sans text-[28px] font-semibold tracking-[0.16em] tabular-nums"
                    >
                      {relay.activePin.slice(0, 3)} {relay.activePin.slice(3)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      Expires in {Math.floor(pinRemainingSec / 60)}∶
                      {String(pinRemainingSec % 60).padStart(2, "0")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => void runRelayAction({ type: "RELAY_CREATE_PIN" })}
                  >
                    Generate new PIN
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant={relay.pairedPhones.length > 0 ? "outline" : "default"}
                  className="min-h-11 w-full"
                  onClick={() => void runRelayAction({ type: "RELAY_CREATE_PIN" })}
                >
                  <Link2 className="size-4" />
                  Generate pairing PIN
                </Button>
              )}
            </div>

            {/* Paired & Favorite Phones */}
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Paired & favorite phones</p>
              {relay && relay.pairedPhones.length > 0 ? (
                <ul className="space-y-2">
                  {[...relay.pairedPhones]
                    .sort((a, b) =>
                      a.phoneId === relay.favoritePhoneId
                        ? -1
                        : b.phoneId === relay.favoritePhoneId
                          ? 1
                          : 0,
                    )
                    .map((phone) => {
                      const isFavorite = relay.favoritePhoneId === phone.phoneId;
                      return (
                        <li
                          key={phone.phoneId}
                          className={`flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 ${
                            isFavorite ? "border-[#f6cc76]/60" : "border-border"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">
                              {phone.phoneName}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {phone.online ? "Online" : "Offline"}
                              {isFavorite ? " · Favorite" : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={
                                isFavorite
                                  ? `Unstar ${phone.phoneName}`
                                  : `Set ${phone.phoneName} as favorite`
                              }
                              title={
                                isFavorite ? "Favorite phone" : "Set as favorite"
                              }
                              onClick={() =>
                                void runRelayAction({
                                  type: "RELAY_SET_FAVORITE_PHONE",
                                  phoneId: isFavorite ? null : phone.phoneId,
                                })
                              }
                            >
                              <Star
                                className={`size-3.5 ${
                                  isFavorite
                                    ? "fill-[#f6cc76] text-[#f6cc76]"
                                    : "text-muted-foreground"
                                }`}
                              />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-destructive"
                              onClick={() =>
                                void runRelayAction({
                                  type: "RELAY_REVOKE_PAIRING",
                                  phoneId: phone.phoneId,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No paired phones yet. Pair a phone above, then tap the star to
                  save it as your favorite.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
        )}
      </main>

      {relay?.connectionStatus === "online" && relay.phoneAppUrl && (
        <footer className="flex items-center justify-between gap-2 border-t border-border bg-card/60 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              Phone URL (same Wi-Fi)
            </p>
            <p className="truncate font-mono text-xs font-semibold text-[#72dfaa]">
              {relay.phoneAppUrl}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Copy phone URL"
            title="Copy phone URL"
            onClick={() => {
              void navigator.clipboard?.writeText(relay.phoneAppUrl!);
              setCopiedPhoneUrl(true);
              window.setTimeout(() => setCopiedPhoneUrl(false), 2000);
            }}
          >
            {copiedPhoneUrl ? (
              <Check className="size-3.5 text-[#72dfaa]" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </footer>
      )}
    </div>
  );
}
