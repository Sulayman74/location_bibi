import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

function injectSwVersion() {
  return {
    name: 'inject-sw-version',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js')
      if (!existsSync(swPath)) return
      const version = `v${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '.')}`
      let sw = readFileSync(swPath, 'utf-8')
      sw = sw.replace(/CACHE_VERSION\s*=\s*'[^']*'/, `CACHE_VERSION = '${version}'`)
      writeFileSync(swPath, sw)
      console.log(`\x1b[32m✓\x1b[0m SW cache version → ${version}`)
    },
  }
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [injectSwVersion()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        reservation: resolve(__dirname, 'reservation.html'),
        guest:       resolve(__dirname, 'guest.html'),
        admin:       resolve(__dirname, 'admin.html'),
        offline:     resolve(__dirname, 'offline.html'),
      },
      output: {
        // Chunks nommés lisiblement
        manualChunks: {
          firebase:  ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          messaging: ['firebase/messaging'],
        },
      },
    },
  },

  // Dev server
  server: {
    port: 5000,
    open: true,
    // Proxy Cloud Functions vers l'émulateur Firebase local
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },

  // Résolution des alias
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  // Variables d'environnement : préfixe VITE_
  envPrefix: 'VITE_',
})
