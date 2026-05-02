/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Allows plugin files in plugins/*/frontend/ to import core modules
      // as: import { formatDate } from '@core/utils/email'
      "@core": path.resolve(__dirname, "./src"),
    },
    // Use symlink paths (not real paths) for module resolution so that plugin
    // files under frontend/plugins/ (a symlink to ../plugins) can resolve
    // node_modules from frontend/node_modules/ rather than the real path.
    preserveSymlinks: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // base './' makes all asset paths relative so Electron can load via file://
  base: process.env.ELECTRON ? './' : '/',
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    fs: {
      // Allow serving files from the repo root so plugins/ can be glob-imported
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
})
