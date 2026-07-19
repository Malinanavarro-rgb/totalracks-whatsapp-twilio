import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';
import { formatearMoneda, formatearFecha } from '../formato';

export default function Dashboard() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.analitica().then(setDatos).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="pm-error">No se pudo cargar la analítica: {error}</p>;
  if (!datos) return <p className="pm-nota">Cargando…</p>;

  const porEstado = datos.clientesPorEstadoSuscripcion || {};

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Analítica global</h1><p>Últimos 30 días · todas las organizaciones</p></div>
      </div>

      <div className="pm-kpi-grid">
        <div className="pm-kpi"><div className="l">MRR</div><div className="v">{formatearMoneda(datos.mrrCentavos)}</div></div>
        <div className="pm-kpi"><div className="l">ARR</div><div className="v">{formatearMoneda(datos.arrCentavos)}</div></div>
        <div className="pm-kpi"><div className="l">Churn mensual</div><div className="v">{datos.churnPct}%</div></div>
        <div className="pm-kpi"><div className="l">Organizaciones activas</div><div className="v">{datos.organizacionesActivas}</div></div>
        <div className="pm-kpi"><div className="l">Ingreso del mes</div><div className="v">{formatearMoneda(datos.ingresoCentavos)}</div></div>
        <div className="pm-kpi"><div className="l">Ticket promedio</div><div className="v">{formatearMoneda(datos.ticketPromedioCentavos)}</div></div>
      </div>

      <div className="pm-kpi-grid" style={{ marginBottom: '1.6rem' }}>
        <div className="pm-kpi"><div className="l">Trial</div><div className="v">{porEstado.trial || 0}</div></div>
        <div className="pm-kpi"><div className="l">Active</div><div className="v">{porEstado.active || 0}</div></div>
        <div className="pm-kpi"><div className="l">Past due</div><div className="v">{porEstado.past_due || 0}</div></div>
        <div className="pm-kpi"><div className="l">Suspended</div><div className="v">{porEstado.suspended || 0}</div></div>
        <div className="pm-kpi"><div className="l">Cancelled</div><div className="v">{porEstado.cancelled || 0}</div></div>
        <div className="pm-kpi"><div className="l">Expired</div><div className="v">{porEstado.expired || 0}</div></div>
      </div>

      <div className="pm-grid-2">
        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Empresas con mayor uso</h2><span className="n">por costo de IA, 30 días</span></div>
          <div className="pm-panel-body">
            {(datos.empresasPorUso || []).length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin consumo registrado todavía.</p>}
            {(datos.empresasPorUso || []).length > 0 && (
              <table>
                <thead><tr><th>Empresa</th><th>Conversaciones</th><th>Tokens</th><th>Costo IA</th></tr></thead>
                <tbody>
                  {datos.empresasPorUso.map(e => (
                    <tr key={e.company_id}>
                      <td>{e.nombre}</td>
                      <td className="tabular">{e.eventos}</td>
                      <td className="tabular">{e.tokens.toLocaleString('es-MX')}</td>
                      <td className="tabular">${e.costoUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Pagos pendientes</h2><span className="n">{datos.pagosPendientes?.cantidad ?? 0} en past_due</span></div>
          <div className="pm-panel-body">
            {(datos.pagosPendientes?.organizaciones || []).length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Nadie debe en este momento.</p>}
            {(datos.pagosPendientes?.organizaciones || []).map(o => (
              <div className="pm-accion-fila" key={o.organizationId}>
                <div className="pm-txt"><b>{o.nombre}</b><span>{o.plan}</span></div>
                <span className="pm-tabular">{formatearMoneda(o.montoCentavos)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-head"><h2>Próximos cobros</h2><span className="n">siguientes 7 días</span></div>
        <div className="pm-panel-body">
          {(datos.proximosCobros || []).length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Nada por renovar esta semana.</p>}
          {(datos.proximosCobros || []).map(c => (
            <div className="pm-accion-fila" key={c.organizationId}>
              <div className="pm-txt"><b>{c.nombre}</b><span>{c.plan}</span></div>
              <span className="pm-tabular">{formatearFecha(c.fecha)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
