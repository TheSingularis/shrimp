import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // base './' makes all asset paths relative so Electron can load via file://
  base: process.env.ELECTRON ? './' : '/',
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
})
