import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
  },
  server: {
    port: 3142,
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3141' },
      '/ws': { target: 'ws://127.0.0.1:3141', ws: true },
    },
  },
})
