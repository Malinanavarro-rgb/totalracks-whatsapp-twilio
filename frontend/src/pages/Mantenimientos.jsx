import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Subfase 2I (Alina, 2026-09-28) — tablero global, estado derivado
// (modules/mantenimientos.js::calcularEstadoMantenimiento), nunca guardado.
const ETIQUETA_ESTADO = { pendiente: 'Pendiente', programado: 'Programado', vencido: 'Vencido', realizado: 'Realizado' };
const SEVERIDAD_ESTADO = { realizado: 'success', vencido: 'error', programado: 'warning', pendiente: 'neutral' };

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Mantenimientos() {
  const [mantenimientos, setMantenimientos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.mantenimientos().then(setMantenimientos).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Mantenimientos</h1>
      </div>

      {error && <p className="login-error">{error}</p>}
      {mantenimientos === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {mantenimientos?.length === 0 && <p className="operaciones-nota">Todavía no hay mantenimientos registrados — se crean desde el detalle de un proyecto.</p>}

      {mantenimientos && mantenimientos.length > 0 && (
        <table>
          <thead>
            <tr><th>Proyecto</th><th>Tipo</th><th>Técnico</th><th>Programado</th><th>Realizado</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {mantenimientos.map((m) => (
              <tr key={m.id}>
                <td><NavLink to={`/proyectos/${m.proyecto_id}`}>Ver proyecto</NavLink></td>
                <td>{m.tipo}</td>
                <td>{m.tecnico_nombre || '—'}</td>
                <td>{formatearFecha(m.fecha_programada)}</td>
                <td>{formatearFecha(m.fecha_realizada)}</td>
                <td><span className={`pill pill--${SEVERIDAD_ESTADO[m.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[m.estado]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
