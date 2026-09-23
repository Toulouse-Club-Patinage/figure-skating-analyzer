/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // MCP + OAuth (servis par le backend, cf. app/mcp/dispatcher.py).
      // Clés regex : « /autorisation » (page React) ne doit PAS être relayée.
      "^/(mcp|authorize|token|register|revoke)(\\?.*)?$": {
        target: "http://localhost:8000",
      },
      "^/\\.well-known/oauth-": {
        target: "http://localhost:8000",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
