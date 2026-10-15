import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

const gitHash = process.env.GIT_SHA && process.env.GIT_SHA !== 'unknown' ? process.env.GIT_SHA : (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`${gitHash} · ${buildTime}`) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'],
      manifest: {
        name: 'Gas Turbine Lab',
        short_name: 'TurbineLab',
        description: 'Design-point cycle analysis of turbojet, turbofan and turboprop engines with station thermodynamics, thrust, fuel consumption and shaft power balance.',
        theme_color: '#0f1113',
        background_color: '#0f1113',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['education', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
