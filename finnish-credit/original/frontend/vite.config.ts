import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal browser polyfill for the Buffer global that @solana/web3.js reaches for.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env": {},
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  server: {
    port: 5173,
  },
});
