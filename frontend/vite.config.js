import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TARA Matrix™ — Plataforma SaaS, Fase 1
// El dev server de Vite reenvía /api al backend Express (localhost:3000) —
// evita CORS en desarrollo sin tocar el backend para permitirlo.
export default defineConfig({
  plugins: [react()],
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
