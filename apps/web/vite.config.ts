import { fileURLToPath } from 'node:url'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import { browserBuildPolicy } from '../../scripts/build-policy.mjs'

export default defineConfig({
  plugins: [UnoCSS(), browserBuildPolicy(fileURLToPath(new URL('../../', import.meta.url)))],
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
