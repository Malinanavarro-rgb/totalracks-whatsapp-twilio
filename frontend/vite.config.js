import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// TARA Matrix™ — Plataforma SaaS, Fase 1
// El dev server de Vite reenvía /api al backend Express (localhost:3000) —
// evita CORS en desarrollo sin tocar el backend para permitirlo.
export default defineConfig({
  plugins: [
    react(),
    // PWA (Fase Rediseño de Panel): mismo panel web, instalable en el
    // teléfono desde el navegador — sin publicarse en tiendas de apps.
    // registerType 'prompt' (no 'autoUpdate'): un cambio de versión del
    // panel no debe reemplazar la app a medio uso sin avisar — se aplica
    // en el siguiente arranque.
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'TARA-OS — Panel',
        short_name: 'TARA-OS',
        description: 'Panel operativo de TARA-OS: conversaciones, agenda, CRM y más.',
        start_url: '/operaciones',
        display: 'standalone',
        background_color: '#fafbfc',
        theme_color: '#0b0f19',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // No cachear /api/* como si fuera un asset estático — el panel
        // siempre necesita datos frescos (conversaciones, agenda, etc.).
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Necesario para que el navegador reenvíe la cookie httpOnly de sesión.
        cookieDomainRewrite: 'localhost',
      },
    },
  },
})
