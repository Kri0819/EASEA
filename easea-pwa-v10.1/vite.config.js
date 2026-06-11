import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name:             'Easea',
        short_name:       'Easea',
        description:      '時間像水一樣流動。你只需要做現在這一件事。',
        theme_color:      '#6E8ED8',
        background_color: '#ECF0FA',
        display:          'standalone',
        orientation:      'portrait',
        start_url:        '/',
        scope:            '/',
        lang:             'zh-TW',
        icons: [
          {
            src:     'icons/icon-192.png',
            sizes:   '192x192',
            type:    'image/png',
            purpose: 'any'
          },
          {
            src:     'icons/icon-512.png',
            sizes:   '512x512',
            type:    'image/png',
            purpose: 'any'
          },
          {
            src:     'icons/icon-512-maskable.png',
            sizes:   '512x512',
            type:    'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            // Supabase API — network-first so data is always fresh
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 5
            }
          }
        ]
      },
      // Dev mode: enable SW in development for testing
      devOptions: {
        enabled: false
      }
    })
  ]
})
