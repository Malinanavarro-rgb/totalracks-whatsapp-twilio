import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Portafolio de Servicios → Paquetes (Alina, 2026-08-10): "Servicio →
// cotizaciones relacionadas → clientes interesados". Para paneles solares
// el catálogo real es `paquetes_solares` (confirmado en la auditoría —
// `servicios` es de otra industria, no se usa aquí) — este es su único
// dueño en el frontend, no una vista paralela de /catalogo.
const SEVERIDAD_ESTADO = {
  aceptada: 'success', enviada: 'warning', vista: 'warning',
  rechazada: 'error', vencida: 'error', borrador: 'neutral',
};

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

export default function Paquetes() {
  const [paquetes, setPaquetes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.paquetesConCotizaciones().then(setPaquetes).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Paquetes</h1>

      {error && <p className="login-error">{error}</p>}
      {paquetes === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {paquetes?.length === 0 && <p className="operaciones-nota">Todavía no hay paquetes configurados.</p>}

      {paquetes?.map((p) => (
        <section key={p.id} className="crm-seccion">
          <div className="crm-seccion-header">
            <h2>{p.nombre} {!p.activo && <span className="pill pill--neutral">Inactivo</span>}</h2>
            <span>{formatearMonto(p.precio_contado)}</span>
          </div>
          <p className="operaciones-nota">{p.cantidad_paneles} paneles · {p.marca_panel || '—'} {p.modelo_panel || ''}</p>

          {p.cotizaciones.length === 0 ? (
            <p className="operaciones-nota">Sin cotizaciones relacionadas todavía.</p>
          ) : (
            <table>
              <thead><tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Estatus</th><th></th></tr></thead>
              <tbody>
                {p.cotizaciones.map((c) => (
                  <tr key={c.id}>
                    <td>{c.folio || '—'}</td>
                    <td>{c.clientes?.nombre || c.clientes?.telefono || '—'}</td>
                    <td>{formatearMonto(c.total)}</td>
                    <td><span className={`pill pill--${SEVERIDAD_ESTADO[c.estado] || 'neutral'}`}>{c.estado}</span></td>
                    <td><NavLink to={`/cotizaciones/${c.id}`}>Ver</NavLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
