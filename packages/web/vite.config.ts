import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [UnoCSS()],
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
  },
  server: {
    port: 3142,
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3141' },
      '/api': { target: 'http://127.0.0.1:3141' },
    },
  },
})
