import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 8014,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
