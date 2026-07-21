import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

// Inbox Inteligente (v0.4) — vista mínima de un hilo, de solo lectura por
// ahora. La Zona 2 (adjuntos, responder desde aquí, Storage) y las Zonas 3/4
// (Panel Inteligente, Panel de Acción) se construyen encima de esta base.
export default function InboxHilo() {
  const { hiloId } = useParams();
  const [mensajes, setMensajes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.mensajesDeHilo(hiloId).then(setMensajes).catch((e) => setError(e.message));
  }, [hiloId]);

  return (
    <div>
      <p><Link to="/inbox">← Volver al Inbox</Link></p>
      <h1>Conversación</h1>

      {error && <p className="login-error">{error}</p>}
      {mensajes === null && !error && <p className="operaciones-nota">Cargando…</p>}

      {mensajes && (
        <div className="historial-mensajes">
          {mensajes.length === 0 && <p className="operaciones-nota">Sin mensajes todavía.</p>}
          {mensajes.map((m) => (
            <div key={m.id} className={`mensaje-burbuja mensaje-burbuja--${m.direccion === 'entrante' ? 'cliente' : (m.remitente_tipo === 'ia' ? 'tara' : m.remitente_tipo)}`}>
              <span className="mensaje-texto">
                {m.tipo_contenido === 'texto' ? m.contenido : `[${m.tipo_contenido}] ${m.contenido || ''}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
