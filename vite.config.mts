import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "gpaster-dev-csp",
    transformIndexHtml(html, context) {
      return context.server
        ? html.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173")
        : html;
    }
  }],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
