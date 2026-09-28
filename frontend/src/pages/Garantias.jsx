import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Subfase 2H (Alina, 2026-09-28) — vista global de garantías, con vigencia
// calculada (nunca guardada) por modules/garantias.js::calcularVigenciaGarantia.
function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Garantias() {
  const [garantias, setGarantias] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.garantias().then(setGarantias).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Garantías</h1>
      </div>

      {error && <p className="login-error">{error}</p>}
      {garantias === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {garantias?.length === 0 && <p className="operaciones-nota">Todavía no hay garantías registradas — se crean desde "Ver garantía" en el detalle de un proyecto.</p>}

      {garantias && garantias.length > 0 && (
        <table>
          <thead>
            <tr><th>Equipo</th><th>Proveedor</th><th>Inicio</th><th>Vence</th><th>Vigencia</th><th></th></tr>
          </thead>
          <tbody>
            {garantias.map((g) => (
              <tr key={g.id}>
                <td>{g.equipo ? `${g.equipo.tipo_equipo}${g.equipo.marca ? ' ' + g.equipo.marca : ''}${g.equipo.modelo ? ' ' + g.equipo.modelo : ''}` : '—'}{g.equipo?.numero_serie ? ` — S/N ${g.equipo.numero_serie}` : ''}</td>
                <td>{g.proveedor || '—'}</td>
                <td>{formatearFecha(g.fecha_inicio)}</td>
                <td>{formatearFecha(g.fecha_fin)}</td>
                <td>
                  {g.vigente === null ? <span className="pill pill--neutral">sin datos suficientes</span>
                    : g.vigente ? <span className="pill pill--success">Vigente ({g.dias_restantes} días)</span>
                    : <span className="pill pill--error">Vencida</span>}
                </td>
                <td><NavLink to={`/garantias/${g.id}`}>Ver</NavLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
