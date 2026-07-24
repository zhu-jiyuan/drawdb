/* eslint-env node */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // cloud API served by server/ (see compose.cloud.yml); same-origin in
      // prod. Object form: the string shorthand implies changeOrigin, which
      // rewrites Host and trips the server's CSRF origin check.
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:3001' },
    },
  },
})
