import http from "node:http";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { RelayCore, type RelayConfig } from "./relayCore.ts";
import { YouTubeSearchService } from "./youtubeSearch.ts";

interface SocketMeta {
  role: "receiver" | "phone" | null;
  id: string | null;
  remoteAddress: string;
}

interface PendingForwardCommand {
  phoneId: string;
  sessionId: string;
  commandId: string;
  timer: NodeJS.Timeout;
}

function getLanPhoneUrl(): string | null {
  const webPort = Number(process.env.WEB_PORT ?? 5173);
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return `http://${entry.address}:${webPort}`;
      }
    }
  }
  return null;
}

export function createRelayServer(
  config: RelayConfig = {},
  searchService = new YouTubeSearchService(),
) {
  const core = new RelayCore(config);
  const receiverSockets = new Map<string, WebSocket>();
  const phoneSockets = new Map<string, WebSocket>();
  const pendingCommands = new Map<string, PendingForwardCommand>();

  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "relo-relay" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  function sendJson(ws: WebSocket | undefined, payload: unknown) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function pushReceiverState(receiverId: string) {
    const ws = receiverSockets.get(receiverId);
    if (!ws) return;
    sendJson(ws, {
      type: "RECEIVER_STATE",
      state: {
        ...core.getReceiverStateSnapshot(receiverId),
        phoneAppUrl: getLanPhoneUrl(),
      },
    });
  }

  function pushPhoneState(phoneId: string) {
    const ws = phoneSockets.get(phoneId);
    if (!ws) return;
    sendJson(ws, {
      type: "PHONE_STATE",
      state: core.getPhoneStateSnapshot(phoneId),
    });
  }

  function notifyPairedPhonesOfReceiverStatus(receiverId: string) {
    for (const [phoneId] of phoneSockets) {
      if (core.isPaired(phoneId, receiverId)) {
        pushPhoneState(phoneId);
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const meta: SocketMeta = {
      role: null,
      id: null,
      remoteAddress: req.socket.remoteAddress ?? "unknown",
    };

    ws.on("message", (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(rawData)) as Record<string, unknown>;
      } catch {
        sendJson(ws, {
          type: "ERROR",
          errorCode: "INVALID_JSON",
          error: "Malformed JSON message.",
        });
        return;
      }

      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        sendJson(ws, {
          type: "ERROR",
          errorCode: "INVALID_MESSAGE",
          error: "Message type is required.",
        });
        return;
      }

      if (msg.type === "PING") {
        sendJson(ws, { type: "PONG" });
        return;
      }

      if (msg.type === "RECEIVER_AUTH") {
        const auth = core.authenticateReceiver(
          msg.receiverId,
          msg.secret,
          msg.deviceName,
        );
        if (!auth.ok) {
          sendJson(ws, {
            type: "AUTH_ERROR",
            errorCode: auth.errorCode,
            error: auth.error,
          });
          return;
        }
        const prev = receiverSockets.get(auth.receiver.receiverId);
        if (prev && prev !== ws) {
          prev.close(4001, "Replaced by newer connection");
        }
        meta.role = "receiver";
        meta.id = auth.receiver.receiverId;
        receiverSockets.set(auth.receiver.receiverId, ws);

        sendJson(ws, {
          type: "AUTH_OK",
          role: "receiver",
          receiverId: auth.receiver.receiverId,
          state: {
            ...core.getReceiverStateSnapshot(auth.receiver.receiverId),
            phoneAppUrl: getLanPhoneUrl(),
          },
        });
        notifyPairedPhonesOfReceiverStatus(auth.receiver.receiverId);
        return;
      }

      if (msg.type === "PHONE_AUTH") {
        const auth = core.authenticatePhone(
          msg.phoneId,
          msg.secret,
          msg.phoneName,
        );
        if (!auth.ok) {
          sendJson(ws, {
            type: "AUTH_ERROR",
            errorCode: auth.errorCode,
            error: auth.error,
          });
          return;
        }
        const prev = phoneSockets.get(auth.phone.phoneId);
        if (prev && prev !== ws) {
          prev.close(4001, "Replaced by newer connection");
        }
        meta.role = "phone";
        meta.id = auth.phone.phoneId;
        phoneSockets.set(auth.phone.phoneId, ws);

        sendJson(ws, {
          type: "AUTH_OK",
          role: "phone",
          phoneId: auth.phone.phoneId,
          state: core.getPhoneStateSnapshot(auth.phone.phoneId),
        });
        return;
      }

      if (!meta.role || !meta.id) {
        sendJson(ws, {
          type: "ERROR",
          errorCode: "AUTH_REQUIRED",
          error: "Authenticate before sending messages.",
        });
        return;
      }

      // Receiver-only messages
      if (meta.role === "receiver") {
        const receiverId = meta.id;

        switch (msg.type) {
          case "CREATE_PAIRING_PIN": {
            const res = core.createPairingPin(receiverId);
            if (!res.ok) {
              sendJson(ws, {
                type: "PAIRING_PIN_ERROR",
                error: res.error,
              });
              return;
            }
            sendJson(ws, {
              type: "PAIRING_PIN_CREATED",
              pin: res.pin,
              expiresAt: res.expiresAt,
            });
            return;
          }

          case "PAIR_CONFIRM": {
            const phoneId = typeof msg.phoneId === "string" ? msg.phoneId : "";
            const approve = Boolean(msg.approve);
            const res = core.confirmPairing(receiverId, phoneId, approve);
            if (!res.ok) {
              sendJson(ws, {
                type: "PAIR_CONFIRM_ERROR",
                errorCode: res.errorCode,
                error: res.error,
              });
              return;
            }
            pushReceiverState(receiverId);
            sendJson(phoneSockets.get(phoneId), {
              type: "PAIR_RESULT",
              approved: res.approved,
              receiverId: res.receiverId,
              deviceName: res.deviceName,
            });
            pushPhoneState(phoneId);
            return;
          }

          case "SESSION_RESPOND": {
            const sessionId =
              typeof msg.sessionId === "string" ? msg.sessionId : "";
            const approve = Boolean(msg.approve);
            const res = core.respondToSession(receiverId, sessionId, approve);
            if (!res.ok) {
              sendJson(ws, {
                type: "SESSION_RESPOND_ERROR",
                errorCode: res.errorCode,
                error: res.error,
              });
              return;
            }
            pushReceiverState(receiverId);
            sendJson(phoneSockets.get(res.session.phoneId), {
              type: "SESSION_UPDATED",
              session: res.session,
            });
            pushPhoneState(res.session.phoneId);
            return;
          }

          case "SESSION_REVOKE": {
            const sessionId =
              typeof msg.sessionId === "string" ? msg.sessionId : "";
            const res = core.revokeSession(receiverId, sessionId);
            if (!res.ok) {
              sendJson(ws, { type: "ERROR", error: res.error });
              return;
            }
            pushReceiverState(receiverId);
            sendJson(phoneSockets.get(res.session.phoneId), {
              type: "SESSION_UPDATED",
              session: res.session,
            });
            pushPhoneState(res.session.phoneId);
            return;
          }

          case "PAIRING_REVOKE": {
            const phoneId = typeof msg.phoneId === "string" ? msg.phoneId : "";
            const revokedSessions = core.revokePairing(receiverId, phoneId);
            pushReceiverState(receiverId);
            for (const s of revokedSessions) {
              sendJson(phoneSockets.get(phoneId), {
                type: "SESSION_UPDATED",
                session: s,
              });
            }
            sendJson(phoneSockets.get(phoneId), {
              type: "PAIRING_REVOKED",
              receiverId,
            });
            pushPhoneState(phoneId);
            return;
          }

          case "RECEIVER_PLAYER_STATE": {
            core.updateReceiverSnapshot(receiverId, msg.snapshot ?? null);
            for (const [phoneId, pws] of phoneSockets) {
              const snap = core.getReceiverSnapshotForPhone(phoneId, receiverId);
              if (snap) {
                sendJson(pws, {
                  type: "REMOTE_PLAYER_STATE",
                  receiverId,
                  snapshot: snap,
                });
              }
            }
            return;
          }

          case "COMMAND_RESULT": {
            const commandId =
              typeof msg.commandId === "string" ? msg.commandId : "";
            const pending = pendingCommands.get(commandId);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingCommands.delete(commandId);

            const entry = {
              ok: Boolean(msg.ok),
              error: typeof msg.error === "string" ? msg.error : undefined,
              errorCode:
                typeof msg.errorCode === "string" ? msg.errorCode : undefined,
              snapshot: msg.snapshot,
            };
            core.recordCommandResult(pending.sessionId, commandId, entry);
            sendJson(phoneSockets.get(pending.phoneId), {
              type: "REMOTE_COMMAND_RESULT",
              commandId,
              ...entry,
            });
            return;
          }
        }
        return;
      }

      // Phone-only messages
      if (meta.role === "phone") {
        const phoneId = meta.id;

        switch (msg.type) {
          case "PAIR_SUBMIT": {
            const rateKey = `${phoneId}:${meta.remoteAddress}`;
            const res = core.submitPairingPin(phoneId, msg.pin, rateKey);
            if (!res.ok) {
              sendJson(ws, {
                type: "PAIR_SUBMIT_ERROR",
                errorCode: res.errorCode,
                error: res.error,
              });
              return;
            }
            sendJson(ws, {
              type: "PAIR_PENDING_CONFIRMATION",
              receiverId: res.receiverId,
              deviceName: res.deviceName,
              expiresAt: res.expiresAt,
            });
            sendJson(receiverSockets.get(res.receiverId), {
              type: "PAIR_INCOMING",
              phoneId: res.phoneId,
              phoneName: res.phoneName,
              expiresAt: res.expiresAt,
            });
            return;
          }

          case "SESSION_REQUEST": {
            const receiverId =
              typeof msg.receiverId === "string" ? msg.receiverId : "";
            const res = core.requestSession(phoneId, receiverId);
            if (!res.ok) {
              sendJson(ws, {
                type: "SESSION_REQUEST_ERROR",
                errorCode: res.errorCode,
                error: res.error,
              });
              return;
            }
            sendJson(ws, {
              type: "SESSION_UPDATED",
              session: res.session,
            });
            pushPhoneState(phoneId);
            pushReceiverState(receiverId);
            sendJson(receiverSockets.get(receiverId), {
              type: "SESSION_INCOMING",
              session: res.session,
              phoneName: res.phoneName,
            });
            return;
          }

          case "SESSION_END": {
            const sessionId =
              typeof msg.sessionId === "string" ? msg.sessionId : "";
            const res = core.endSessionByPhone(phoneId, sessionId);
            if (!res.ok) return;
            pushPhoneState(phoneId);
            pushReceiverState(res.session.receiverId);
            return;
          }

          case "REMOTE_COMMAND": {
            const receiverId =
              typeof msg.receiverId === "string" ? msg.receiverId : "";
            const commandId =
              typeof msg.commandId === "string" ? msg.commandId : "";
            const auth = core.authorizeCommand(
              phoneId,
              receiverId,
              msg.sessionId,
              commandId,
              msg.action,
            );
            if (!auth.ok) {
              sendJson(ws, {
                type: "REMOTE_COMMAND_RESULT",
                commandId,
                ok: false,
                errorCode: auth.errorCode,
                error: auth.error,
              });
              pushPhoneState(phoneId);
              return;
            }

            if (auth.duplicate && auth.cachedResult) {
              sendJson(ws, {
                type: "REMOTE_COMMAND_RESULT",
                commandId,
                duplicate: true,
                ...auth.cachedResult,
              });
              return;
            }

            const recWs = receiverSockets.get(receiverId);
            if (!recWs || recWs.readyState !== WebSocket.OPEN) {
              sendJson(ws, {
                type: "REMOTE_COMMAND_RESULT",
                commandId,
                ok: false,
                errorCode: "RECEIVER_OFFLINE",
                error: "Desktop receiver is offline.",
              });
              return;
            }

            const timer = setTimeout(() => {
              pendingCommands.delete(commandId);
              sendJson(phoneSockets.get(phoneId), {
                type: "REMOTE_COMMAND_RESULT",
                commandId,
                ok: false,
                errorCode: "RECEIVER_TIMEOUT",
                error: "Desktop receiver did not respond in time.",
              });
            }, 10_000);

            pendingCommands.set(commandId, {
              phoneId,
              sessionId: auth.session.sessionId,
              commandId,
              timer,
            });

            sendJson(recWs, {
              type: "EXECUTE_REMOTE_COMMAND",
              sessionId: auth.session.sessionId,
              phoneId,
              commandId,
              action: auth.action,
            });
            return;
          }

          case "YOUTUBE_SEARCH": {
            const requestId =
              typeof msg.requestId === "string" ? msg.requestId : "";
            if (!core.checkSearchRateLimit(phoneId)) {
              sendJson(ws, {
                type: "YOUTUBE_SEARCH_RESULT",
                requestId,
                ok: false,
                errorCode: "RATE_LIMITED",
                error:
                  "Too many searches in a short time. Wait a moment or paste a link.",
              });
              return;
            }
            void searchService.search(msg.query).then((res) => {
              sendJson(ws, {
                type: "YOUTUBE_SEARCH_RESULT",
                requestId,
                ...res,
              });
            });
            return;
          }

          case "YOUTUBE_SUGGEST": {
            const requestId =
              typeof msg.requestId === "string" ? msg.requestId : "";
            void searchService.suggest(msg.query).then((suggestions) => {
              sendJson(ws, {
                type: "YOUTUBE_SUGGEST_RESULT",
                requestId,
                suggestions,
              });
            });
            return;
          }
        }
      }
    });

    ws.on("close", () => {
      if (meta.role === "receiver" && meta.id) {
        if (receiverSockets.get(meta.id) === ws) {
          receiverSockets.delete(meta.id);
          core.setReceiverOffline(meta.id);
          notifyPairedPhonesOfReceiverStatus(meta.id);
        }
      } else if (meta.role === "phone" && meta.id) {
        if (phoneSockets.get(meta.id) === ws) {
          phoneSockets.delete(meta.id);
          core.setPhoneOffline(meta.id);
        }
      }
    });
  });

  return {
    server,
    wss,
    core,
    start(port = 8787, host?: string) {
      return new Promise<{ port: number; host?: string }>((resolve) => {
        const onListening = () => {
          const addr = server.address();
          const actualPort =
            addr && typeof addr === "object" ? addr.port : port;
          resolve({ port: actualPort, host });
        };
        if (host) {
          server.listen(port, host, onListening);
        } else {
          server.listen(port, onListening);
        }
      });
    },
    stop() {
      for (const pending of pendingCommands.values()) {
        clearTimeout(pending.timer);
      }
      pendingCommands.clear();
      return new Promise<void>((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    },
  };
}
