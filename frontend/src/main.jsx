import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: registerType 'prompt' (vite.config.js) exige registrar manualmente —
// nunca reemplaza el panel a medio uso sin avisar; solo pregunta cuando
// hay una versión nueva lista.
const actualizarSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('Hay una versión nueva de TARA-OS disponible. ¿Actualizar ahora?')) {
      actualizarSW(true); // true: aplica el service worker nuevo y recarga
    }
  },
  onOfflineReady() {
    console.log('TARA-OS ya está lista para usarse sin conexión.');
  },
});
