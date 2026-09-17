import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

function formatearFechaHora(iso) {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

function duracionEnMinutos(inicio, fin) {
  return Math.round((new Date(fin) - new Date(inicio)) / 60000);
}

// Vista de detalle de una cita — no existía ninguna en el panel (Alina,
// 2026-08-11, demo LUMÉ Hair Studio): las vistas de Agenda solo mostraban
// hora/cliente/estado. Trae todo en una sola llamada (GET
// /api/agenda/citas/:id → modules/agenda.js::obtenerCita) — cliente,
// asesor, servicio, y la conversación (hilo) relacionada, si existe.
export default function CitaDetalleModal({ citaId, onCerrar }) {
  const [cita, setCita]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.citaDetalle(citaId).then(setCita).catch((e) => setError(e.message));
  }, [citaId]);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-tarjeta" onClick={(e) => e.stopPropagation()}>
        <h2>Detalle de la cita</h2>

        {error && <p className="login-error">{error}</p>}
        {!cita && !error && <p className="operaciones-nota">Cargando…</p>}

        {cita && (
          <dl className="cita-detalle-lista">
            <dt>Cliente</dt>
            <dd><Link to={`/crm/clientes/${cita.clientes?.id}`}>{cita.clientes?.nombre || 'Sin nombre'}</Link></dd>

            <dt>Teléfono</dt>
            <dd>{cita.clientes?.telefono || '—'}</dd>

            <dt>Servicio</dt>
            <dd>{cita.servicios?.nombre || 'Sin servicio asignado'}</dd>

            <dt>Fecha y hora</dt>
            <dd>{formatearFechaHora(cita.inicio)}</dd>

            <dt>Duración</dt>
            <dd>{duracionEnMinutos(cita.inicio, cita.fin)} minutos</dd>

            <dt>Asesor</dt>
            <dd>{cita.asesores?.nombre || 'Sin asignar'}</dd>

            <dt>Estado</dt>
            <dd><span className={`agenda-estado agenda-estado--${cita.estado}`}>{cita.estado}</span></dd>

            {cita.precio_cobrado != null && (
              <>
                <dt>Precio</dt>
                <dd>${Number(cita.precio_cobrado).toLocaleString('es-MX')}</dd>
              </>
            )}

            {cita.notas && (
              <>
                <dt>Notas</dt>
                <dd>{cita.notas}</dd>
              </>
            )}

            <dt>Conversación relacionada</dt>
            <dd>
              {cita.hilo
                ? <Link to={`/inbox/${cita.hilo.id}`}>Ver conversación</Link>
                : 'Sin conversación asociada (cita creada manualmente)'}
            </dd>

            <dt>Google Calendar</dt>
            <dd>{cita.calendar_event_id || 'No sincronizada (sin Google Calendar conectado)'}</dd>
          </dl>
        )}

        <div className="modal-acciones">
          <button type="button" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
