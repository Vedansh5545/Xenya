// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load all env vars (both VITE_* and others) so we can read VITE_API_TARGET
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_TARGET || 'http://localhost:3000' // default Node server

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Proxy API calls to the Node server in dev so fetch('/api/...') works
        '/api': { target, changeOrigin: true, secure: false },
        // Optional: forward these server routes too if you use them
        '^/(calendar|oauth|auth)': { target, changeOrigin: true, secure: false },
      },
    },
    // Make "vite preview" behave similarly to dev regarding proxies
    preview: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true, secure: false },
        '^/(calendar|oauth|auth)': { target, changeOrigin: true, secure: false },
      },
    },
    // Keep default base. If you deploy under a sub-path, set base accordingly.
    // base: '/',
  }
})
