import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Subfase 2E (Alina, 2026-09-28) — tablero de todos los trámites CFE de la
// empresa, ordenado por antigüedad de actualización (los más atrasados
// primero) — mismos 10 estados que modules/tramites-cfe.js::ESTADOS_TRAMITE_CFE.
const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente', documentos_en_revision: 'Documentos en revisión', ingresado_cfe: 'Ingresado a CFE',
  en_revision_cfe: 'En revisión por CFE', visita_tecnica_programada: 'Visita técnica programada',
  visita_tecnica_realizada: 'Visita técnica realizada', contrato_firmado: 'Contrato firmado',
  medidor_solicitado: 'Medidor solicitado', medidor_instalado: 'Medidor instalado', interconexion_completada: 'Interconexión completada',
};
const SEVERIDAD_ESTADO = { interconexion_completada: 'success', pendiente: 'neutral' };

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TramitesCfe() {
  const [tramites, setTramites] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.tramitesCfe().then(setTramites).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Trámites CFE</h1>
      </div>

      {error && <p className="login-error">{error}</p>}
      {tramites === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {tramites?.length === 0 && <p className="operaciones-nota">Todavía no hay trámites CFE iniciados — se inician desde el detalle de un proyecto.</p>}

      {tramites && tramites.length > 0 && (
        <table>
          <thead>
            <tr><th>Proyecto</th><th>Estado</th><th>Folio CFE</th><th>Última actualización</th><th></th></tr>
          </thead>
          <tbody>
            {tramites.map((t) => (
              <tr key={t.id}>
                <td><NavLink to={`/proyectos/${t.proyecto_id}`}>Ver proyecto</NavLink></td>
                <td><span className={`pill pill--${SEVERIDAD_ESTADO[t.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[t.estado] || t.estado}</span></td>
                <td>{t.folio_cfe || '—'}</td>
                <td>{formatearFechaHora(t.ultima_actualizacion)}</td>
                <td>{t.alerta && <span className="pill pill--error">⚠ {t.dias_sin_actualizacion} días sin actualizar</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
