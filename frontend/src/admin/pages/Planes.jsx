import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';
import { formatearMoneda } from '../formato';

export default function Planes() {
  const [planes, setPlanes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.planes().then(setPlanes).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="pm-error">No se pudieron cargar los planes: {error}</p>;
  if (!planes) return <p className="pm-nota">Cargando…</p>;

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Planes</h1><p>Catálogo TARA — editable, sin tocar código</p></div>
      </div>

      <div className="pm-plan-grid">
        {planes.map(plan => (
          <div className={`pm-plan-card${plan.clave === 'unlimited' ? ' pm-plan-card--destacado' : ''}${!plan.es_autoservicio ? ' pm-plan-card--enterprise' : ''}`} key={plan.id}>
            <div className="pm-plan-card-head">
              <b>{plan.nombre}</b>
              <span className={`pm-pill ${plan.activo ? 'pm-pill--ok' : 'pm-pill--muted'}`}><i />{plan.activo ? 'Activo' : 'Inactivo'}</span>
            </div>
            {plan.precio_centavos == null ? (
              <div className="pm-plan-precio pm-plan-precio--custom">A la medida</div>
            ) : plan.precio_centavos === 0 ? (
              <div className="pm-plan-precio">$0<span>/ {plan.dias_prueba} días</span></div>
            ) : (
              <div className="pm-plan-precio">{formatearMoneda(plan.precio_centavos)}<span>MXN / {plan.periodo}</span></div>
            )}
            <ul className="pm-plan-perks">
              {(plan.perks || []).map((perk, i) => <li key={i}>{perk}</li>)}
            </ul>
            {!plan.es_autoservicio && <button className="pm-btn pm-btn--primario pm-plan-cta">Solicitar demostración</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
