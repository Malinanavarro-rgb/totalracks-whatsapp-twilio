import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';

export default function SolicitudesAmpliacion() {
  const [solicitudes, setSolicitudes] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('pendiente');
  const [enviandoId, setEnviandoId] = useState(null);

  function cargar() {
    adminApi.solicitudesAmpliacion(filtro || undefined).then(setSolicitudes).catch(e => setError(e.message));
  }

  useEffect(cargar, [filtro]);

  async function revisar(solicitud, aprobar) {
    const verbo = aprobar ? 'aprobar' : 'rechazar';
    if (!window.confirm(`¿${verbo === 'aprobar' ? 'Aprobar' : 'Rechazar'} la solicitud de "${solicitud.modulos_catalogo?.nombre || solicitud.modulo_codigo}" de ${solicitud.companies?.nombre}?`)) return;

    setEnviandoId(solicitud.id);
    try {
      await adminApi.revisarSolicitudAmpliacion(solicitud.id, aprobar);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviandoId(null);
    }
  }

  if (error) return <p className="pm-error">No se pudieron cargar las solicitudes: {error}</p>;
  if (!solicitudes) return <p className="pm-nota">Cargando…</p>;

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Solicitudes de ampliación</h1><p>Revisión manual — sin gateway de pago conectado</p></div>
        <select value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="pendiente">Pendientes</option>
          <option value="aprobada">Aprobadas</option>
          <option value="rechazada">Rechazadas</option>
          <option value="">Todas</option>
        </select>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-body">
          {solicitudes.length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin solicitudes.</p>}
          {solicitudes.map(s => (
            <div className="pm-accion-fila" key={s.id}>
              <div className="pm-txt">
                <b>{s.companies?.nombre || s.company_id}</b>
                <span>{s.modulos_catalogo?.nombre || s.modulo_codigo || 'Ampliación general'} — {new Date(s.created_at).toLocaleString('es-MX')}{s.notas ? ` — "${s.notas}"` : ''}</span>
              </div>
              {s.estado === 'pendiente' ? (
                <div className="pm-accion-control">
                  <button className="pm-btn pm-btn--chico" disabled={enviandoId === s.id} onClick={() => revisar(s, true)}>Aprobar</button>
                  <button className="pm-btn pm-btn--chico pm-btn--peligro" disabled={enviandoId === s.id} onClick={() => revisar(s, false)}>Rechazar</button>
                </div>
              ) : (
                <span className={`pm-pill ${s.estado === 'aprobada' ? 'pm-pill--ok' : 'pm-pill--danger'}`}><i />{s.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
