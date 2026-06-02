import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index-DUt_foXO.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name || ''
          if (name.endsWith('.css')) return 'assets/index-CDJ2U3B7.css'
          if (name === 'instrument-serif-2.woff2') return 'assets/instrument-serif-2-DGrY7Whw.woff2'
          if (name === 'inter-7.woff2') return 'assets/inter-7-8kRkwJBP.woff2'
          if (name === 'jetbrains-mono-6.woff2') return 'assets/jetbrains-mono-6-Db4Uuiha.woff2'
          return 'assets/[name][extname]'
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8013,
  },
  preview: {
    host: '127.0.0.1',
    port: 8013,
  },
})
