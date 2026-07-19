import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../adminApi';
import { formatearMoneda, formatearFecha, ESTADO_ETIQUETA, ESTADO_CLASE } from '../formato';

export default function CentroCobro() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    adminApi.centroCobro().then(setFilas).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="pm-error">No se pudo cargar el Centro de Cobro: {error}</p>;
  if (!filas) return <p className="pm-nota">Cargando…</p>;

  const ingresoTotal = filas.reduce((acc, f) => acc + f.ingresoCentavos, 0);
  const costoTotalUsd = filas.reduce((acc, f) => acc + f.costoUsd, 0);
  const margenTotal = filas.reduce((acc, f) => acc + f.margenCentavos, 0);

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Centro de Cobro</h1><p>Ingreso, costo de IA y margen real por organización</p></div>
      </div>

      <div className="pm-kpi-grid" style={{ marginBottom: '1.1rem' }}>
        <div className="pm-kpi"><div className="l">Ingreso mensual total</div><div className="v">{formatearMoneda(ingresoTotal)}</div></div>
        <div className="pm-kpi"><div className="l">Costo IA total (30d)</div><div className="v">${costoTotalUsd.toFixed(2)} <span style={{ fontSize: '0.7rem', color: 'var(--pm-text-faint)' }}>USD</span></div></div>
        <div className="pm-kpi"><div className="l">Margen combinado</div><div className="v" style={{ color: margenTotal >= 0 ? 'var(--pm-ok)' : 'var(--pm-danger)' }}>{formatearMoneda(margenTotal)}</div></div>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-head"><h2>Por organización</h2><span className="n">tipo de cambio aproximado — no es cifra contable exacta</span></div>
        <div className="pm-panel-body" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Empresa</th><th>Plan</th><th>Estado</th><th>Vence</th><th>Ingreso/mes</th><th>Costo IA</th><th>Margen</th></tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.organizationId} onClick={() => navigate(`/admin/organizaciones/${f.organizationId}`)}>
                  <td>{f.nombre}</td>
                  <td>{f.plan || '—'}</td>
                  <td>{f.estadoSuscripcion ? <span className={`pm-pill ${ESTADO_CLASE[f.estadoSuscripcion]}`}><i />{ESTADO_ETIQUETA[f.estadoSuscripcion]}</span> : <span className="pm-nota-inline">Sin suscripción</span>}</td>
                  <td className="tabular">{formatearFecha(f.proximoCobro)}</td>
                  <td className="tabular">{formatearMoneda(f.ingresoCentavos)}</td>
                  <td className="tabular">${f.costoUsd.toFixed(2)}</td>
                  <td className="tabular" style={{ color: f.margenCentavos >= 0 ? 'var(--pm-ok)' : 'var(--pm-danger)' }}>{formatearMoneda(f.margenCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
