import { defineConfig } from 'vite'

/**
 * `base` must match the GitHub Pages project path (https://<user>.github.io/codechat/).
 * Override with VITE_BASE=/ for a root-domain deploy.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/codechat/',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
  },
  server: { port: 5176, strictPort: false },
  preview: { port: 4176 },
})
