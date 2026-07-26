import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3142,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3141", ws: true },
    },
  },
});
