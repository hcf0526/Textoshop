import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 本地开发时把登录请求转发给 server/index.mjs
  server: {
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  build: {
    sourcemap: false,
    outDir: 'dist',
    minify: 'esbuild',
  }
})
