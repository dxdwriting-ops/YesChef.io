import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the same build works on its own domain and inside itch.io's player.
  base: "./",
  server: {
    port: 5173,
    // Lets friends on the same network join your dev server.
    host: true,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1000,
  },
});
