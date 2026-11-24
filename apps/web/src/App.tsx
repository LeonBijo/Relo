import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Link2,
  LoaderCircle,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import logo from "@/assets/relo-icon-48.png";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { validateYouTubeVideoUrl } from "@/shared/youtubeUrl";

const STORAGE_KEY = "reloPhoneIdentity";

interface PhoneIdentityStorage {
  phoneId: string;
  phoneSecret: string;
  phoneName: string;
  relayUrl?: string;
  favoriteReceiverId?: string;
}

interface SessionInfo {
  sessionId: string;
  phoneId: string;
  receiverId: string;
  status: "pending" | "active" | "denied" | "expired" | "revoked";
  createdAt: number;
  requestExpiresAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

interface YouTubeTabInfo {
  tabId: number;
  title: string;
  active: boolean;
  audible: boolean;
  isDesignated: boolean;
}

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  durationText: string;
  thumbnailUrl: string;
  watchUrl: string;
}

interface PlayerSnapshot {
  status: "ready" | "loading" | "missing_player" | "error";
  videoId: string | null;
  title: string;
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
  errorMessage?: string;
  designatedTabId?: number | null;
  availableTabs?: YouTubeTabInfo[];
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

interface PairedReceiverInfo {
  receiverId: string;
  deviceName: string;
  online: boolean;
  session: SessionInfo | null;
  playerSnapshot: PlayerSnapshot | null;
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getDefaultRelayUrl(): string {
  const envUrl = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (envUrl && envUrl.trim()) return envUrl.trim();
  const isCapacitor =
    typeof (window as unknown as { Capacitor?: unknown }).Capacitor !==
    "undefined";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  if (isCapacitor && host === "localhost") {
    // Inside native Android WebView, localhost refers to the phone itself;
    // default to the desktop LAN relay IP (can also be overridden in Devices).
    return "ws://192.168.1.4:8787/ws";
  }
  return `${proto}//${host}:8787/ws`;
}

function loadIdentity(): PhoneIdentityStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PhoneIdentityStorage>;
      if (
        typeof parsed.phoneId === "string" &&
        parsed.phoneId.length >= 8 &&
        typeof parsed.phoneSecret === "string" &&
        parsed.phoneSecret.length >= 16
      ) {
        return {
          phoneId: parsed.phoneId,
          phoneSecret: parsed.phoneSecret,
          phoneName:
            typeof parsed.phoneName === "string" && parsed.phoneName.trim()
              ? parsed.phoneName.trim()
              : "My Phone",
          relayUrl: parsed.relayUrl,
        };
      }
    }
  } catch {
    // Ignore storage parse error and regenerate
  }
  const fresh: PhoneIdentityStorage = {
    phoneId: `ph-${randomHex(12)}`,
    phoneSecret: randomHex(32),
    phoneName: "My Phone",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

export function App() {
  const [identity, setIdentity] = useState<PhoneIdentityStorage>(() =>
    loadIdentity(),
  );
  const [relayUrl, setRelayUrl] = useState<string>(
    () => identity.relayUrl || getDefaultRelayUrl(),
  );
  const [relayStatus, setRelayStatus] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [pairedReceivers, setPairedReceivers] = useState<PairedReceiverInfo[]>(
    [],
  );
  const [selectedReceiverId, setSelectedReceiverId] = useState<string>("");

  // Pairing form state
  const [pin, setPin] = useState("");
  const [phoneNameInput, setPhoneNameInput] = useState(identity.phoneName);
  const [pairingState, setPairingState] = useState<
    "idle" | "submitting" | "awaiting_desktop" | "paired"
  >("idle");
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);

  // Remote playback state
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"remote" | "devices">("devices");
  const wasAuthorizedRef = useRef(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const selectedReceiverIdRef = useRef(selectedReceiverId);
  selectedReceiverIdRef.current = selectedReceiverId;

  const persistIdentity = useCallback(
    (patch: Partial<PhoneIdentityStorage>) => {
      setIdentity((prev) => {
        const next = { ...prev, ...patch };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const sendWs = useCallback((payload: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const connectRelay = useCallback(
    (targetUrl: string, currentIdentity: PhoneIdentityStorage) => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const old = wsRef.current;
        wsRef.current = null;
        old.close();
      }

      setRelayStatus("connecting");
      try {
        const ws = new WebSocket(targetUrl);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          if (wsRef.current !== ws) return;
          ws.send(
            JSON.stringify({
              type: "PHONE_AUTH",
              phoneId: currentIdentity.phoneId,
              secret: currentIdentity.phoneSecret,
              phoneName: currentIdentity.phoneName,
            }),
          );
        });

        ws.addEventListener("message", (event) => {
          if (wsRef.current !== ws) return;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          } catch {
            return;
          }

          switch (msg.type) {
            case "AUTH_OK":
            case "PHONE_STATE": {
              setRelayStatus("online");
              const state = msg.state as
                | { pairedReceivers?: PairedReceiverInfo[] }
                | undefined;
              if (state?.pairedReceivers) {
                setPairedReceivers(state.pairedReceivers);
                setSelectedReceiverId((prev) => {
                  if (
                    prev &&
                    state.pairedReceivers!.some((r) => r.receiverId === prev)
                  ) {
                    return prev;
                  }
                  const favId = currentIdentity.favoriteReceiverId;
                  if (
                    favId &&
                    state.pairedReceivers!.some((r) => r.receiverId === favId)
                  ) {
                    return favId;
                  }
                  return state.pairedReceivers![0]?.receiverId ?? "";
                });
              }
              break;
            }

            case "AUTH_ERROR": {
              setRelayStatus("offline");
              setPairingError(
                typeof msg.error === "string"
                  ? msg.error
                  : "Phone authentication failed.",
              );
              break;
            }

            case "PAIR_PENDING_CONFIRMATION": {
              setPairingState("awaiting_desktop");
              setPairingError(null);
              setPairingMessage(
                `Confirm pairing on ${String(msg.deviceName ?? "your desktop")}.`,
              );
              break;
            }

            case "PAIR_SUBMIT_ERROR": {
              setPairingState("idle");
              setPairingMessage(null);
              setPairingError(
                typeof msg.error === "string"
                  ? msg.error
                  : "Pairing PIN was rejected.",
              );
              break;
            }

            case "PAIR_RESULT": {
              if (msg.approved) {
                setPairingState("paired");
                setPairingError(null);
                setPin("");
                setPairingMessage(
                  `Paired with ${String(msg.deviceName ?? "desktop")}. Request a session to start controlling playback.`,
                );
                if (typeof msg.receiverId === "string") {
                  setSelectedReceiverId(msg.receiverId);
                }
              } else {
                setPairingState("idle");
                setPairingMessage(null);
                setPairingError("Pairing was rejected on the desktop.");
              }
              break;
            }

            case "SESSION_UPDATED": {
              const updated = msg.session as SessionInfo | undefined;
              if (!updated?.receiverId) break;
              if (updated.status !== "active") {
                setIsSending(false);
              }
              setPairedReceivers((prev) =>
                prev.map((r) =>
                  r.receiverId === updated.receiverId
                    ? { ...r, session: updated }
                    : r,
                ),
              );
              break;
            }

            case "PAIRING_REVOKED": {
              setPairingState("idle");
              setIsSending(false);
              setCommandStatus(null);
              setCommandError(
                "Desktop pairing was revoked. Enter a new pairing PIN to reconnect.",
              );
              break;
            }

            case "SESSION_REQUEST_ERROR": {
              setCommandError(
                typeof msg.error === "string"
                  ? msg.error
                  : "Could not request control session.",
              );
              break;
            }

            case "REMOTE_PLAYER_STATE": {
              const receiverId = String(msg.receiverId ?? "");
              const snapshot = msg.snapshot as PlayerSnapshot | undefined;
              if (!receiverId || !snapshot) break;
              setPairedReceivers((prev) =>
                prev.map((r) =>
                  r.receiverId === receiverId
                    ? { ...r, playerSnapshot: snapshot }
                    : r,
                ),
              );
              break;
            }

            case "REMOTE_COMMAND_RESULT": {
              setIsSending(false);
              if (msg.ok) {
                setCommandError(null);
                setCommandStatus("Command delivered to desktop.");
                if (msg.snapshot) {
                  const targetRxId = selectedReceiverIdRef.current;
                  setPairedReceivers((prev) =>
                    prev.map((r) =>
                      r.receiverId === targetRxId
                        ? { ...r, playerSnapshot: msg.snapshot as PlayerSnapshot }
                        : r,
                    ),
                  );
                }
              } else {
                setCommandStatus(null);
                setCommandError(
                  typeof msg.error === "string"
                    ? msg.error
                    : "Command failed on desktop.",
                );
              }
              break;
            }

            case "YOUTUBE_SEARCH_RESULT": {
              setIsSearching(false);
              if (msg.ok) {
                setSearchError(null);
                setSearchResults(
                  Array.isArray(msg.results)
                    ? (msg.results as YouTubeSearchResult[])
                    : [],
                );
              } else {
                setSearchResults([]);
                setSearchError(
                  typeof msg.error === "string"
                    ? msg.error
                    : "YouTube search failed.",
                );
              }
              break;
            }

            case "YOUTUBE_SUGGEST_RESULT": {
              setSuggestions(
                Array.isArray(msg.suggestions)
                  ? (msg.suggestions as string[])
                  : [],
              );
              break;
            }
          }
        });

        ws.addEventListener("close", () => {
          if (wsRef.current !== ws || unmountedRef.current) return;
          wsRef.current = null;
          setRelayStatus("offline");
          reconnectTimerRef.current = window.setTimeout(() => {
            if (!unmountedRef.current) {
              connectRelay(targetUrl, currentIdentity);
            }
          }, 3000);
        });

        ws.addEventListener("error", () => {
          if (wsRef.current !== ws) return;
          setRelayStatus("offline");
        });
      } catch {
        setRelayStatus("offline");
      }
    },
    [],
  );

  useEffect(() => {
    unmountedRef.current = false;
    connectRelay(relayUrl, identity);
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    // Only reconnect on explicit relayUrl change or mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrl]);

  const activeReceiver =
    pairedReceivers.find((r) => r.receiverId === selectedReceiverId) ??
    pairedReceivers[0] ??
    null;
  selectedReceiverIdRef.current = activeReceiver?.receiverId ?? "";

  const session = activeReceiver?.session ?? null;
  const sessionStatus = session?.status ?? null;
  const isAuthorized =
    relayStatus === "online" &&
    Boolean(activeReceiver?.online) &&
    sessionStatus === "active";

  useEffect(() => {
    if (isAuthorized && !wasAuthorizedRef.current) {
      setActiveTab("remote");
      if (activeReceiver && session) {
        const commandId =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : randomHex(12);
        sendWs({
          type: "REMOTE_COMMAND",
          receiverId: activeReceiver.receiverId,
          sessionId: session.sessionId,
          commandId,
          action: { type: "REFRESH_STATE" },
        });
      }
    }
    wasAuthorizedRef.current = isAuthorized;
  }, [isAuthorized, activeReceiver, session, sendWs]);

  const player = activeReceiver?.playerSnapshot ?? null;

  let badgeLabel = "Offline";
  let badgeClass = "text-muted-foreground";
  if (relayStatus === "connecting") {
    badgeLabel = "Connecting";
    badgeClass = "text-[#f6cc76]";
  } else if (relayStatus === "online") {
    if (isAuthorized) {
      badgeLabel = "Authorized";
      badgeClass = "text-[#72dfaa]";
    } else if (sessionStatus === "pending") {
      badgeLabel = "Approval pending";
      badgeClass = "text-[#f6cc76]";
    } else if (sessionStatus === "denied") {
      badgeLabel = "Denied";
      badgeClass = "text-destructive";
    } else if (sessionStatus === "expired") {
      badgeLabel = "Expired";
      badgeClass = "text-muted-foreground";
    } else if (sessionStatus === "revoked") {
      badgeLabel = "Revoked";
      badgeClass = "text-muted-foreground";
    } else if (pairedReceivers.length > 0) {
      badgeLabel = activeReceiver?.online ? "Paired · Online" : "Paired · Offline";
      badgeClass = activeReceiver?.online
        ? "text-[#72dfaa]"
        : "text-muted-foreground";
    } else {
      badgeLabel = "Online";
      badgeClass = "text-[#72dfaa]";
    }
  }

  function handlePairSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPairingError(null);
    setPairingMessage(null);

    const cleanedPin = pin.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanedPin)) {
      setPairingError("Enter the 6-digit pairing PIN shown on your desktop.");
      return;
    }

    const nextName = phoneNameInput.trim() || "My Phone";
    persistIdentity({ phoneName: nextName });

    // Re-authenticate with updated name before submitting PIN
    sendWs({
      type: "PHONE_AUTH",
      phoneId: identity.phoneId,
      secret: identity.phoneSecret,
      phoneName: nextName,
    });

    if (!sendWs({ type: "PAIR_SUBMIT", pin: cleanedPin })) {
      setPairingError("Relay is offline. Check your connection and try again.");
      return;
    }
    setPairingState("submitting");
  }

  function handleRequestSession() {
    if (!activeReceiver) return;
    setCommandError(null);
    setCommandStatus(null);
    if (
      !sendWs({
        type: "SESSION_REQUEST",
        receiverId: activeReceiver.receiverId,
      })
    ) {
      setCommandError("Relay is offline.");
    }
  }

  function handleDisconnectSession() {
    if (!session) return;
    sendWs({ type: "SESSION_END", sessionId: session.sessionId });
    setCommandStatus(null);
  }

  function sendRemoteAction(
    action:
      | { type: "PLAY_VIDEO_URL"; url: string }
      | { type: "DESIGNATE_TAB"; tabId: number }
      | { type: "FOCUS_TAB" }
      | { type: "CLOSE_TAB" }
      | { type: "REFRESH_STATE" }
      | {
          type: "PLAYER_COMMAND";
          command:
            | { type: "PLAY" | "PAUSE" | "TOGGLE_PLAY" }
            | { type: "SEEK_RELATIVE"; deltaSeconds: number }
            | { type: "SEEK_TO"; timeSeconds: number }
            | { type: "SET_VOLUME"; volume: number }
            | { type: "SET_MUTED"; muted: boolean };
        },
  ) {
    if (!activeReceiver || !session || !isAuthorized) {
      setCommandError("Desktop approval is required before sending commands.");
      return;
    }
    const commandId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomHex(12);

    setIsSending(true);
    setCommandError(null);
    setCommandStatus(null);

    if (
      !sendWs({
        type: "REMOTE_COMMAND",
        receiverId: activeReceiver.receiverId,
        sessionId: session.sessionId,
        commandId,
        action,
      })
    ) {
      setIsSending(false);
      setCommandError("Relay is offline. Reconnect and try again.");
    }
  }

  function handlePlayVideo(e: React.FormEvent) {
    e.preventDefault();
    const check = validateYouTubeVideoUrl(videoUrl);
    if (!check.ok) {
      setVideoError(check.error);
      return;
    }
    setVideoError(null);
    sendRemoteAction({ type: "PLAY_VIDEO_URL", url: check.canonicalUrl });
    setVideoUrl("");
  }

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!isAuthorized || !showSuggestions || trimmed.length < 2) {
      if (trimmed.length < 2) setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const requestId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : randomHex(12);
      sendWs({ type: "YOUTUBE_SUGGEST", requestId, query: trimmed });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchQuery, isAuthorized, showSuggestions, sendWs]);

  function runYouTubeSearch(queryText: string) {
    const trimmed = queryText.trim();
    if (!trimmed) {
      setSearchError("Enter a search term.");
      return;
    }
    setShowSuggestions(false);
    setSuggestions([]);
    setSearchError(null);
    setIsSearching(true);
    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomHex(12);
    if (!sendWs({ type: "YOUTUBE_SEARCH", requestId, query: trimmed })) {
      setIsSearching(false);
      setSearchError("Relay is offline. Reconnect and try again.");
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    runYouTubeSearch(searchQuery);
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-background text-foreground">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src={logo} className="size-7" alt="RELO" />
          <span className="text-base font-bold tracking-[0.2em]">RELO</span>
        </div>
        <Badge variant="outline" className={`shrink-0 gap-2 whitespace-nowrap px-2.5 py-1 text-xs ${badgeClass}`}>
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {badgeLabel}
        </Badge>
      </header>

      <main className="space-y-4 p-5">
        {relayStatus === "offline" && (
          <Alert variant="destructive" className="border-border bg-card">
            <WifiOff className="size-4" />
            <AlertTitle>Relay offline</AlertTitle>
            <AlertDescription className="space-y-2 text-xs leading-5">
              <p>Cannot reach relay at {relayUrl}.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() => connectRelay(relayUrl, identity)}
              >
                <RefreshCw className="size-3.5" />
                Retry connection
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "remote" | "devices")}
          className="gap-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0">
            <TabsTrigger
              value="remote"
              className="min-h-11 rounded-lg border border-border text-sm data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Remote
            </TabsTrigger>
            <TabsTrigger
              value="devices"
              className="min-h-11 rounded-lg border border-border text-sm data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Devices
            </TabsTrigger>
          </TabsList>

          <TabsContent value="remote" className="mt-0 space-y-4">
            {!isAuthorized ? (
              <Card className="gap-4 py-5 shadow-none">
                <CardHeader className="gap-1.5 px-5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-4" />
                    {pairedReceivers.length === 0
                      ? "No desktop paired"
                      : sessionStatus === "pending"
                        ? "Approval pending"
                        : "Session not active"}
                  </CardTitle>
                  <CardDescription className="text-xs leading-5">
                    {pairedReceivers.length === 0
                      ? "Pair with your desktop in the Devices tab first."
                      : sessionStatus === "pending"
                        ? `Approve this request in the RELO extension on ${activeReceiver?.deviceName}.`
                        : "Request a control session to unlock playback controls."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-5">
                  {pairedReceivers.length > 0 && activeReceiver?.online ? (
                    <Button
                      type="button"
                      className="min-h-11 w-full"
                      disabled={
                        relayStatus !== "online" || sessionStatus === "pending"
                      }
                      onClick={handleRequestSession}
                    >
                      {sessionStatus === "pending" ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          Waiting for desktop approval
                        </>
                      ) : (
                        "Request control"
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full"
                      onClick={() => setActiveTab("devices")}
                    >
                      Go to Devices
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              /* Authorized Remote Controls — sole focus when connected */
              <Card className="gap-4 py-5 shadow-none">
            <CardHeader className="min-w-0 gap-1.5 px-5">
              <CardTitle className="truncate text-base">
                Remote · {activeReceiver?.deviceName}
              </CardTitle>
              <CardDescription className="truncate text-xs leading-5">
                {player?.title
                  ? `${player.title} · ${player.isPlaying ? "Playing" : "Paused"}`
                  : "Send a YouTube link to play on the designated desktop tab."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              {/* Designated YouTube Tab Selector + Focus / Close */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">
                    YouTube tabs ({player?.availableTabs?.length ?? 0})
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Refresh YouTube tabs"
                    title="Refresh YouTube tabs"
                    onClick={() => sendRemoteAction({ type: "REFRESH_STATE" })}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                {player?.availableTabs && player.availableTabs.length > 0 ? (
                  <div className="space-y-1.5" role="radiogroup" aria-label="YouTube tabs">
                    {player.availableTabs.map((tab) => {
                      const isSelected = tab.tabId === player.designatedTabId;
                      const tags = [
                        tab.active ? "Active" : null,
                        tab.audible ? "Audio" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <button
                          key={tab.tabId}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() =>
                            sendRemoteAction({
                              type: "DESIGNATE_TAB",
                              tabId: tab.tabId,
                            })
                          }
                          className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">
                              {tab.title}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {tags ? `${tags} · #${tab.tabId}` : `#${tab.tabId}`}
                            </p>
                          </div>
                          {isSelected && (
                            <span className="shrink-0 text-[11px] font-semibold text-primary">
                              Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    No YouTube tab selected. Send a link below to open one.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 gap-1.5 text-xs"
                    disabled={
                      isSending ||
                      player?.designatedTabId === null ||
                      player?.designatedTabId === undefined
                    }
                    onClick={() => sendRemoteAction({ type: "FOCUS_TAB" })}
                  >
                    <ExternalLink className="size-3.5" />
                    Focus tab
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 gap-1.5 text-xs text-destructive"
                    disabled={
                      isSending ||
                      player?.designatedTabId === null ||
                      player?.designatedTabId === undefined
                    }
                    onClick={() => sendRemoteAction({ type: "CLOSE_TAB" })}
                  >
                    <X className="size-3.5" />
                    Close tab
                  </Button>
                </div>
              </div>

              {/* Search YouTube via Relay API */}
              <form
                onSubmit={handleSearchSubmit}
                className="space-y-2.5 border-t border-border pt-4"
                noValidate
              >
                <Label htmlFor="phone-youtube-search">Search YouTube</Label>
                <div className="flex gap-2">
                  <Input
                    id="phone-youtube-search"
                    type="search"
                    className="min-h-11 flex-1"
                    value={searchQuery}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setSearchQuery(nextVal);
                      if (!nextVal.trim()) {
                        setSuggestions([]);
                        setShowSuggestions(false);
                        setSearchResults([]);
                        setSearchError(null);
                      } else {
                        setShowSuggestions(true);
                        if (searchError) setSearchError(null);
                      }
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder="Search videos…"
                    autoComplete="off"
                    aria-invalid={Boolean(searchError)}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="min-h-11 w-[76px] shrink-0 px-3"
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                  </Button>
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    role="listbox"
                    aria-label="Search suggestions"
                    className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background"
                  >
                    {suggestions.map((suggestion) => (
                      <li key={suggestion}>
                        <button
                          type="button"
                          className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-accent"
                          onClick={() => {
                            setSearchQuery(suggestion);
                            runYouTubeSearch(suggestion);
                          }}
                        >
                          <Search className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{suggestion}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchError && (
                  <p role="alert" className="text-xs text-destructive">
                    {searchError}
                  </p>
                )}
                {searchResults.length > 0 && (
                  <ul className="max-h-64 space-y-2 overflow-y-auto pt-1">
                    {searchResults.map((item) => (
                      <li
                        key={item.videoId}
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-2"
                      >
                        {item.thumbnailUrl && (
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-12 w-20 shrink-0 rounded object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-medium leading-4">
                            {item.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {item.channelTitle} · {item.durationText}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-9 shrink-0 px-3 text-xs"
                          disabled={isSending}
                          onClick={() =>
                            sendRemoteAction({
                              type: "PLAY_VIDEO_URL",
                              url: item.watchUrl,
                            })
                          }
                        >
                          Play
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </form>

              <form onSubmit={handlePlayVideo} className="space-y-2.5 border-t border-border pt-4" noValidate>
                <Label htmlFor="phone-video-link">YouTube video link</Label>
                <div className="flex gap-2">
                  <Input
                    id="phone-video-link"
                    type="url"
                    className="min-h-11 flex-1"
                    value={videoUrl}
                    onChange={(e) => {
                      setVideoUrl(e.target.value);
                      if (videoError) setVideoError(null);
                    }}
                    placeholder="https://youtu.be/..."
                    aria-invalid={Boolean(videoError)}
                  />
                  <Button
                    type="submit"
                    className="min-h-11 w-[76px] shrink-0 px-4"
                    disabled={isSending}
                  >
                    {isSending ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      "Send"
                    )}
                  </Button>
                </div>
                {videoError && (
                  <p role="alert" className="text-xs text-destructive">
                    {videoError}
                  </p>
                )}
              </form>

              {/* Playback Progress Slider */}
              <div className="space-y-2 border-t border-border pt-4">
                <Label htmlFor="phone-playback-position" className="sr-only">
                  Playback position
                </Label>
                <Slider
                  id="phone-playback-position"
                  aria-label="Playback position"
                  className="min-h-8"
                  disabled={
                    isSending ||
                    !player ||
                    player.status !== "ready" ||
                    !player.canSeek ||
                    player.duration === null
                  }
                  min={0}
                  max={
                    player?.duration && player.duration > 0
                      ? player.duration
                      : 100
                  }
                  step={1}
                  value={[
                    player?.duration && player.duration > 0
                      ? Math.min(seekPreview ?? player.currentTime, player.duration)
                      : 0,
                  ]}
                  onValueChange={(vals) => setSeekPreview(vals[0])}
                  onValueCommit={(vals) => {
                    setSeekPreview(null);
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: "SEEK_TO", timeSeconds: vals[0] },
                    });
                  }}
                />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>
                    {player && player.status === "ready"
                      ? formatTime(seekPreview ?? player.currentTime)
                      : "—"}
                  </span>
                  <span>
                    {!player || player.status !== "ready"
                      ? "—"
                      : player.isLive
                        ? "Live"
                        : player.duration !== null
                          ? formatTime(player.duration)
                          : "Unavailable"}
                  </span>
                </div>
              </div>

              {/* Transport Controls: Rewind 10s, Play/Pause, Forward 10s */}
              <div className="flex items-center justify-center gap-4">
                <SeekButton
                  direction="back"
                  disabled={isSending || !player?.canSeek}
                  onClick={() =>
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: "SEEK_RELATIVE", deltaSeconds: -10 },
                    })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  className="size-14 rounded-full"
                  disabled={isSending}
                  aria-label={player?.isPlaying ? "Pause" : "Play"}
                  onClick={() =>
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: player?.isPlaying ? "PAUSE" : "PLAY" },
                    })
                  }
                >
                  {player?.isPlaying ? (
                    <Pause className="size-6" />
                  ) : (
                    <Play className="size-6" />
                  )}
                </Button>
                <SeekButton
                  direction="forward"
                  disabled={isSending || !player?.canSeek}
                  onClick={() =>
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: "SEEK_RELATIVE", deltaSeconds: 10 },
                    })
                  }
                />
              </div>

              {/* Desktop Volume & Mute */}
              <div className="flex items-center gap-3 border-t border-border pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  disabled={isSending || !player || player.status !== "ready"}
                  aria-label={player?.muted ? "Unmute" : "Mute"}
                  aria-pressed={Boolean(player?.muted)}
                  onClick={() =>
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: "SET_MUTED", muted: !player?.muted },
                    })
                  }
                >
                  {player?.muted || (volumePreview ?? player?.volume ?? 100) === 0 ? (
                    <VolumeX className="size-5" />
                  ) : (
                    <Volume2 className="size-5" />
                  )}
                </Button>
                <Slider
                  aria-label="Desktop volume"
                  className="min-h-8 flex-1"
                  disabled={isSending || !player || player.status !== "ready"}
                  min={0}
                  max={100}
                  step={1}
                  value={[
                    volumePreview ?? (player?.muted ? 0 : (player?.volume ?? 100)),
                  ]}
                  onValueChange={(vals) => setVolumePreview(vals[0])}
                  onValueCommit={(vals) => {
                    setVolumePreview(null);
                    sendRemoteAction({
                      type: "PLAYER_COMMAND",
                      command: { type: "SET_VOLUME", volume: vals[0] },
                    });
                  }}
                />
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                  {player && player.status === "ready"
                    ? `${volumePreview ?? (player.muted ? 0 : player.volume)}%`
                    : "—"}
                </span>
              </div>

              <div className="min-h-5">
                {player?.playbackBlocked && player.errorMessage ? (
                  <p className="text-xs text-destructive">{player.errorMessage}</p>
                ) : commandError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {commandError}
                  </p>
                ) : commandStatus ? (
                  <p role="status" className="text-xs text-[#72dfaa]">
                    {commandStatus}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-10 w-full text-xs text-muted-foreground"
                  onClick={handleDisconnectSession}
                >
                  End session
                </Button>
              </div>
            </CardContent>
          </Card>
            )}
          </TabsContent>

          <TabsContent value="devices" className="mt-0 space-y-4">
            {/* Paired Desktop & Session Approval Card */}
            {pairedReceivers.length > 0 && (
              <Card className="gap-4 py-5 shadow-none">
                <CardHeader className="gap-1.5 px-5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Monitor className="size-4" />
                    Desktop receiver
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Playback stays on your desktop. Every new session needs
                    desktop approval.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 px-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="receiver-select">Paired desktop</Label>
                      {activeReceiver && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => {
                            const isFav =
                              identity.favoriteReceiverId ===
                              activeReceiver.receiverId;
                            persistIdentity({
                              favoriteReceiverId: isFav
                                ? undefined
                                : activeReceiver.receiverId,
                            });
                          }}
                        >
                          <Star
                            className={`size-3.5 ${
                              identity.favoriteReceiverId ===
                              activeReceiver.receiverId
                                ? "fill-[#f6cc76] text-[#f6cc76]"
                                : "text-muted-foreground"
                            }`}
                          />
                          {identity.favoriteReceiverId ===
                          activeReceiver.receiverId
                            ? "Favorite"
                            : "Set favorite"}
                        </Button>
                      )}
                    </div>
                    <Select
                      value={activeReceiver?.receiverId ?? ""}
                      onValueChange={setSelectedReceiverId}
                    >
                      <SelectTrigger
                        id="receiver-select"
                        className="min-h-11 w-full"
                      >
                        <SelectValue placeholder="Choose desktop" />
                      </SelectTrigger>
                      <SelectContent>
                        {pairedReceivers.map((r) => (
                          <SelectItem key={r.receiverId} value={r.receiverId}>
                            {r.deviceName} · {r.online ? "Online" : "Offline"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {activeReceiver && !activeReceiver.online && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {activeReceiver.deviceName} is offline. Open your desktop
                      browser with RELO enabled to reconnect.
                    </p>
                  )}

                  {sessionStatus === "pending" && (
                    <Alert className="border-[#f6cc76]/40 bg-background">
                      <LoaderCircle className="size-4 animate-spin text-[#f6cc76]" />
                      <AlertTitle className="text-sm">
                        Approval pending
                      </AlertTitle>
                      <AlertDescription className="text-xs leading-5">
                        Open the RELO extension on {activeReceiver?.deviceName}{" "}
                        and approve this control request.
                      </AlertDescription>
                    </Alert>
                  )}

                  {sessionStatus === "denied" && (
                    <Alert
                      variant="destructive"
                      className="border-border bg-background"
                    >
                      <AlertCircle className="size-4" />
                      <AlertTitle className="text-sm">Request denied</AlertTitle>
                      <AlertDescription className="text-xs leading-5">
                        Desktop declined this control request. Send a new
                        request when ready.
                      </AlertDescription>
                    </Alert>
                  )}

                  {(sessionStatus === "expired" ||
                    sessionStatus === "revoked") && (
                    <Alert className="border-border bg-background">
                      <ShieldCheck className="size-4" />
                      <AlertTitle className="text-sm">
                        {sessionStatus === "expired"
                          ? "Session expired"
                          : "Access ended"}
                      </AlertTitle>
                      <AlertDescription className="text-xs leading-5">
                        Request a new control session and approve it on{" "}
                        {activeReceiver?.deviceName}.
                      </AlertDescription>
                    </Alert>
                  )}

                  {!isAuthorized ? (
                    <Button
                      type="button"
                      className="min-h-11 w-full"
                      disabled={
                        relayStatus !== "online" ||
                        !activeReceiver?.online ||
                        sessionStatus === "pending"
                      }
                      onClick={handleRequestSession}
                    >
                      {sessionStatus === "pending" ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          Waiting for approval
                        </>
                      ) : (
                        "Request control"
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full"
                      onClick={handleDisconnectSession}
                    >
                      End session
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pair a Desktop Card */}
        <Card className="gap-4 py-5 shadow-none">
          <CardHeader className="gap-1.5 px-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="size-4" />
              {pairedReceivers.length > 0
                ? "Pair another desktop"
                : "Pair with your desktop"}
            </CardTitle>
            <CardDescription className="text-xs">
              Open RELO on your desktop, generate a 6-digit PIN, and enter it
              here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            <form onSubmit={handlePairSubmit} className="space-y-3" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="phone-name">Your phone name</Label>
                <Input
                  id="phone-name"
                  className="min-h-11"
                  maxLength={32}
                  value={phoneNameInput}
                  onChange={(e) => setPhoneNameInput(e.target.value)}
                  placeholder="Leon’s phone"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pair-pin">6-digit pairing PIN</Label>
                <Input
                  id="pair-pin"
                  className="min-h-11 font-sans text-lg tracking-[0.2em] tabular-nums"
                  inputMode="numeric"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    if (pairingError) setPairingError(null);
                  }}
                  placeholder="123456"
                  aria-invalid={Boolean(pairingError)}
                />
              </div>

              {pairingError && (
                <p role="alert" className="text-xs text-destructive">
                  {pairingError}
                </p>
              )}
              {pairingMessage && (
                <p role="status" className="text-xs text-[#72dfaa]">
                  {pairingMessage}
                </p>
              )}

              <Button
                type="submit"
                variant={pairedReceivers.length > 0 ? "outline" : "default"}
                className="min-h-11 w-full"
                disabled={
                  relayStatus !== "online" ||
                  pairingState === "submitting" ||
                  pairingState === "awaiting_desktop"
                }
              >
                {pairingState === "awaiting_desktop" ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Awaiting desktop confirmation
                  </>
                ) : (
                  <>
                    <Link2 className="size-4" />
                    Request pairing
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Relay Endpoint Override (for LAN/production troubleshooting) */}
        <details className="rounded-xl border border-border bg-card p-4 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Relay connection ({relayStatus})
          </summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor="phone-relay-url" className="text-xs">
              Relay WebSocket URL
            </Label>
            <div className="flex gap-2">
              <Input
                id="phone-relay-url"
                className="min-h-10 flex-1 font-mono text-xs"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-10"
                onClick={() => {
                  persistIdentity({ relayUrl });
                  connectRelay(relayUrl, identity);
                }}
              >
                Connect
              </Button>
              </div>
            </div>
          </details>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
