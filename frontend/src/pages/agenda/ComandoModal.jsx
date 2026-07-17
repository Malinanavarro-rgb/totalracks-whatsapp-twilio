import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

// ⌘K — puerta de entrada única del Lienzo: buscar, y preguntarle/pedirle
// algo a TARA en lenguaje natural. Nunca ejecuta nada al escribir — solo
// "interpretar" (api.enviarComandoAgenda). Si la intención muta datos,
// TARA muestra exactamente qué entendió y espera un clic explícito de
// "Confirmar" antes de llamar a /confirmar — el mismo patrón que se usará
// para cualquier acción futura de TARA (ver modules/agenda-comandos.js).
export default function ComandoModal({ estado, onCerrar, onEjecutado }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState(null);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function alTeclado(e) { if (e.key === 'Escape') onCerrar(); }
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [onCerrar]);

  const citasConAsesor = (estado?.recursos || []).flatMap(r =>
    (r.citas || []).map(c => ({ ...c, asesorNombre: r.asesorNombre }))
  );
  const textoBusqueda = texto.trim().toLowerCase();
  const coincidencias = textoBusqueda.length >= 2 && !pendiente
    ? citasConAsesor.filter(c =>
        (c.clientes?.nombre || '').toLowerCase().includes(textoBusqueda) ||
        c.asesorNombre.toLowerCase().includes(textoBusqueda)
      ).slice(0, 4)
    : [];

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true); setError(null); setRespuesta(null);
    try {
      const resultado = await api.enviarComandoAgenda(texto.trim());
      if (resultado.requiere_confirmacion) {
        setPendiente({ comando_id: resultado.comando_id, resumen: resultado.resumen });
      } else {
        setRespuesta(resultado.respuesta);
      }
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    setEnviando(true); setError(null);
    try {
      await api.confirmarComandoAgenda(pendiente.comando_id);
      onEjecutado();
      onCerrar();
    } catch (e2) {
      setError(e2.message);
      setEnviando(false);
    }
  }

  async function descartarPendiente() {
    try { await api.cancelarComandoAgenda(pendiente.comando_id); } catch { /* ya resuelto, no pasa nada */ }
    setPendiente(null);
    setTexto('');
    inputRef.current?.focus();
  }

  return (
    <div className="cmdk-fondo" onClick={onCerrar}>
      <div className="cmdk-modal" onClick={(e) => e.stopPropagation()}>
        {!pendiente ? (
          <form className="cmdk-input" onSubmit={enviar}>
            <span className="ai-dot" />
            <input
              ref={inputRef} value={texto} disabled={enviando}
              onChange={(e) => { setTexto(e.target.value); setRespuesta(null); setError(null); }}
              placeholder="Busca o pregúntale a TARA…"
            />
            {enviando && <span className="cmdk-cargando">···</span>}
          </form>
        ) : (
          <div className="cmdk-confirm">
            <span className="cmdk-confirm-label">TARA entendió</span>
            <p>{pendiente.resumen}</p>
            <div className="cmdk-confirm-acciones">
              <button type="button" className="cmdk-primary" onClick={confirmar} disabled={enviando}>Confirmar</button>
              <button type="button" className="cmdk-ghost" onClick={descartarPendiente} disabled={enviando}>Cancelar</button>
            </div>
          </div>
        )}

        {error && <p className="cmdk-error">{error}</p>}
        {respuesta && <p className="cmdk-respuesta">{respuesta}</p>}

        {coincidencias.length > 0 && (
          <div className="cmdk-results">
            {coincidencias.map((c) => (
              <div className="cmdk-item" key={c.id}>
                <span className="ico">◦</span>
                <span>{c.clientes?.nombre || c.clientes?.telefono || 'Sin nombre'} · {c.asesorNombre} · {new Date(c.inicio).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
