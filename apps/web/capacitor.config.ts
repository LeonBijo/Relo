import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.relo.remote",
  appName: "RELO",
  webDir: "dist",
  server: {
    androidScheme: "http",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
