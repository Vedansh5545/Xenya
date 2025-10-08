// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_TARGET || 'http://localhost:3000' // default to your server
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true, secure: false },
        '^/(calendar|oauth|auth)': { target, changeOrigin: true, secure: false },
      },
    },
  }
})
