import { defineConfig } from 'vite'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifestFilename: 'manifest.json',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,webp,svg,ico,woff,woff2}'],
        globIgnores: ['**/screenshots/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        name: "La Cabine du Cap d'Agde – Location Saisonnière",
        short_name: 'Studio Cabine Cap',
        description: 'Portail invité : code WiFi, guide de la villa et recommandations locales',
        start_url: '/guest.html',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f5f0eb',
        theme_color: '#d97706',
        lang: 'fr',
        categories: ['travel', 'lifestyle'],
        icons: [
          { src: '/assets/icons/favicon-72.png',  sizes: '72x72',   type: 'image/png', purpose: 'any' },
          { src: '/assets/icons/favicon-96.png',  sizes: '96x96',   type: 'image/png', purpose: 'any' },
          { src: '/assets/icons/favicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Code WiFi',
            short_name: 'WiFi',
            description: 'Accéder directement au code WiFi',
            url: '/guest.html#wifi',
            icons: [{ src: '/assets/icons/favicon-96.png', sizes: '96x96' }],
          },
          {
            name: 'Réserver',
            short_name: 'Réserver',
            description: 'Réserver le studio',
            url: '/reservation.html',
            icons: [{ src: '/assets/icons/favicon-96.png', sizes: '96x96' }],
          },
        ],
      },
    }),
  ],

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
        manualChunks: {
          firebase:  ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          messaging: ['firebase/messaging'],
        },
      },
    },
  },

  server: {
    port: 5000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  envPrefix: 'VITE_',
})
