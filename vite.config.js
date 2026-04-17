import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  publicDir: 'public',  // sw.js, manifest.json, icons copiés tel quel dans dist/

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
