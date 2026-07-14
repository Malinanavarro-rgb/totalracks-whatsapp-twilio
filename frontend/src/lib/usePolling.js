import { useEffect, useRef, useState } from 'react';

// Fase Demo Comercial: el panel debe "sentirse vivo" mientras un cliente
// conversa por WhatsApp — sin esto, había que recargar la página a mano
// para ver una conversación/oportunidad nueva. Polling simple en vez de
// Supabase Realtime/WebSockets: mismo efecto para una demo en vivo, sin
// infraestructura nueva que configurar antes de mañana.
//
// fetchFn se guarda en un ref para que el intervalo siempre llame a la
// versión más reciente (cierra sobre filtros/params actuales) sin tener
// que reiniciar el setInterval cada vez que esos params cambian.
export function usePolling(fetchFn, intervalMs = 4000) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    let activo = true;
    let esPrimera = true;

    async function tick() {
      try {
        const resultado = await fetchRef.current();
        if (activo) { setDatos(resultado); setError(null); }
      } catch (e) {
        if (activo) setError(e.message);
      } finally {
        if (activo && esPrimera) { setCargando(false); esPrimera = false; }
      }
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { activo = false; clearInterval(id); };
  }, [intervalMs]);

  return { datos, setDatos, error, cargando };
}
