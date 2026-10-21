import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite --mode emulators` runs Hengam against the local Firebase emulators,
  // with /api served by scripts/dev-api.js, so Hengam and Hengam Teams can be
  // exercised together without touching production.
  server: mode === 'emulators'
    ? { proxy: { '/api': 'http://127.0.0.1:3001' } }
    : undefined,
  build: {
    // Never ship source maps: they hand out the original source and make the
    // build stack obvious in devtools.
    sourcemap: false,
    // Opaque, hash-only asset names — nothing in the network tab spells out
    // the framework or the entry file.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('firebase') || id.includes('@firebase')) return 'v-data'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'v-motion'
          if (id.includes('react-router')) return 'v-router'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) return 'v-core'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
}))
