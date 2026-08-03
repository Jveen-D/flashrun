import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const createManualChunks = (id: string) => {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
    return "react-vendor";
  }

  if (id.includes("node_modules/@tauri-apps/")) {
    return "tauri-vendor";
  }

  if (id.includes("node_modules/xterm") || id.includes("node_modules/xterm-addon-")) {
    return "terminal-vendor";
  }

  if (id.includes("node_modules/@dnd-kit/")) {
    return "dnd-vendor";
  }

  if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) {
    return "i18n-vendor";
  }

  if (id.includes("node_modules/lucide-react")) {
    return "icons-vendor";
  }

  return undefined;
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: createManualChunks,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
