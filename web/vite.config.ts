import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3142,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3141', ws: true },
    },
  },
})
