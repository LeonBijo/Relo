import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelayServer } from "./server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (!process.env.YOUTUBE_API_KEY && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST;
const stateFilePath = resolve(__dirname, "..", "data", "relay-state.json");

const relay = createRelayServer({ stateFilePath });
const info = await relay.start(port, host);
console.log(
  `RELO relay listening on http://${info.host ?? "localhost"}:${info.port} (ws path /ws)`,
);
