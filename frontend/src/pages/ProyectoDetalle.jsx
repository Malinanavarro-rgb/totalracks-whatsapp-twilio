import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

// Progreso del proyecto (Subfase 2A, 2026-09-22) — solo "Venta" tiene datos
// reales hoy (el proyecto existe = la venta se cerró). El resto de los
// pasos se muestran deliberadamente como "todavía no existe ese módulo" en
// vez de simular un estado — se activan uno por uno en las subfases 2B-2I.
const PASOS_PROGRESO = [
  { clave: 'venta', etiqueta: 'Venta' },
  { clave: 'cobranza', etiqueta: 'Cobranza' },
  { clave: 'levantamiento', etiqueta: 'Levantamiento' },
  { clave: 'material', etiqueta: 'Material' },
  { clave: 'instalacion', etiqueta: 'Instalación' },
  { clave: 'cfe', etiqueta: 'CFE' },
  { clave: 'entrega', etiqueta: 'Entrega' },
  { clave: 'postventa', etiqueta: 'Garantía / Postventa' },
];

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

export default function ProyectoDetalle() {
  const { proyectoId } = useParams();
  const [proyecto, setProyecto] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.proyecto(proyectoId).then(setProyecto).catch((e) => setError(e.message));
  }, [proyectoId]);

  if (error) return <p className="login-error">{error}</p>;
  if (!proyecto) return <p className="operaciones-nota">Cargando…</p>;

  const v = proyecto.config_vendida || {};

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Proyecto {proyecto.numero_proyecto || `#${proyecto.id}`}</h1>
        <span className="pill pill--success">Venta cerrada</span>
      </div>

      <section className="crm-seccion">
        <h2>Encabezado</h2>
        <dl className="crm-datos-lista">
          <dt>Cliente</dt><dd>{proyecto.cliente_id ? <Link to={`/crm/clientes/${proyecto.cliente_id}`}>{proyecto.cliente_nombre || `Cliente #${proyecto.cliente_id}`}</Link> : '—'}</dd>
          <dt>Teléfono</dt><dd>{proyecto.cliente_telefono || '—'}</dd>
          <dt>Ubicación</dt><dd>{proyecto.ubicacion_instalacion || '—'}</dd>
          <dt>Sucursal</dt><dd>{proyecto.sucursal_nombre || '—'}</dd>
          <dt>Asesor</dt><dd>{proyecto.asesor_nombre || '—'}</dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Sistema vendido</h2>
        {v.panel ? (
          <dl className="crm-datos-lista">
            <dt>Paneles</dt><dd>{v.panel.cantidad ?? '—'} × {v.panel.marca} {v.panel.modelo}</dd>
            <dt>Potencia</dt><dd>{v.potencia_instalada_kwp != null ? `${v.potencia_instalada_kwp.toFixed(2)} kWp` : '—'}</dd>
            <dt>Inversor</dt><dd>{v.inversor ? `${v.inversor.marca} ${v.inversor.modelo}` : '—'}</dd>
            <dt>Cobertura estimada</dt><dd>{v.cobertura_pct != null ? `${v.cobertura_pct.toFixed(0)}%` : '—'}</dd>
            <dt>Generación estimada</dt><dd>{v.produccion_anual_kwh != null ? `${Math.round(v.produccion_anual_kwh).toLocaleString('es-MX')} kWh/año` : '—'}</dd>
          </dl>
        ) : (
          <p className="operaciones-nota">Esta cotización no tenía un cálculo de ingeniería corrido al momento de aceptarse.</p>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Información comercial</h2>
        <dl className="crm-datos-lista">
          <dt>Cotización</dt><dd><Link to={`/cotizaciones/${proyecto.cotizacion_id}`}>{v.cotizacion_folio || `#${proyecto.cotizacion_id}`}</Link></dd>
          <dt>Total</dt><dd>{formatearMonto(v.precio_final_autorizado ?? v.total)}</dd>
          <dt>Paquete</dt><dd>{v.paquete_recomendado || '—'}</dd>
          <dt>Fecha de aceptación</dt><dd>{formatearFechaHora(proyecto.created_at)}</dd>
          <dt>Estado general</dt><dd><span className="pill pill--success">{proyecto.estado}</span></dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Progreso</h2>
        <ul className="config-kb-lista">
          {PASOS_PROGRESO.map((paso) => (
            <li key={paso.clave} className="config-kb-item">
              {paso.clave === 'venta' ? (
                <><span className="pill pill--success">✓</span> {paso.etiqueta} — {formatearFechaHora(proyecto.created_at)}</>
              ) : (
                <><span className="pill pill--neutral">—</span> {paso.etiqueta} <span className="operaciones-nota">(módulo todavía no implementado)</span></>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
