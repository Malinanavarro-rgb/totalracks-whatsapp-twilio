import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

const INTERVALO_POLLING_MS = 12000;

// Fase 3: lista de conversaciones. "Tiempo real" vía polling (simplificación
// aprobada) — sin infraestructura de websockets para el volumen actual.
export default function Conversaciones() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;

    function cargar() {
      api.conversaciones()
        .then((datos) => { if (activo) setLista(datos); })
        .catch((e) => { if (activo) setError(e.message); });
    }

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_POLLING_MS);
    return () => { activo = false; clearInterval(intervalo); };
  }, []);

  return (
    <div>
      <h1>Conversaciones</h1>
      {error && <p className="login-error">No se pudieron cargar las conversaciones: {error}</p>}
      {lista === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {lista?.length === 0 && <p className="operaciones-nota">No hay conversaciones todavía.</p>}

      {lista && lista.length > 0 && (
        <ul className="conversaciones-lista">
          {lista.map((c) => (
            <NavLink key={c.id} to={`/conversaciones/${c.id}`} className="conversacion-item">
              <div className="conversacion-item-encabezado">
                <strong>{c.nombre || c.telefono}</strong>
                <span className={`etiqueta-atencion etiqueta-atencion--${c.atendido_por}`}>
                  {c.atendido_por === 'humano' ? 'Atención personal' : 'TARA'}
                </span>
              </div>
              <p className="conversacion-item-preview">
                {c.ultimoMensaje?.texto || 'Sin mensajes'}
              </p>
              {(c.score_interes != null || c.oportunidad_estado) && (
                <p className="conversacion-item-contexto-crm">
                  {c.score_interes != null && <span>Score: {c.score_interes}</span>}
                  {c.oportunidad_estado && <span>{c.oportunidad_estado}</span>}
                </p>
              )}
            </NavLink>
          ))}
        </ul>
      )}
    </div>
  );
}
