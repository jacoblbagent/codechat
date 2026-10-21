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
  server: {
    port: 5176,
    strictPort: false,
    host: 'localhost', // loopback only (box is rootless; avoid binding all interfaces)
    allowedHosts: [
      'jlb-hermes.tail1caa84.ts.net', // tailnet hostname for tailscale serve :5176
      '*.ts.net', // any Tailscale MagicDNS name reaching this box
    ],
  },
  preview: { port: 4176 },
})
