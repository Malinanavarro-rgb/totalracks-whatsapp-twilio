import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../adminApi';

export default function Organizaciones() {
  const [organizaciones, setOrganizaciones] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    adminApi.organizaciones().then(setOrganizaciones).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="pm-error">No se pudieron cargar las organizaciones: {error}</p>;
  if (!organizaciones) return <p className="pm-nota">Cargando…</p>;

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Organizaciones</h1><p>{organizaciones.length} empresas registradas</p></div>
      </div>

      <div className="pm-org-grid">
        {organizaciones.map(org => {
          const company = org.companies?.[0];
          return (
            <div className="pm-org-card" key={org.id} onClick={() => navigate(`/admin/organizaciones/${org.id}`)}>
              <div className="pm-org-card-top">
                <div className="pm-org-card-id">
                  <span className="pm-org-avatar">{(org.nombre || '?').charAt(0).toUpperCase()}</span>
                  <div><b>{org.nombre}</b><span>{company?.industria_slug || 'Sin giro configurado'}</span></div>
                </div>
                <span className={`pm-pill ${org.estado === 'activa' ? 'pm-pill--ok' : 'pm-pill--danger'}`}>
                  <i /> {org.estado === 'activa' ? 'Activa' : 'Suspendida'}
                </span>
              </div>
              <div className="pm-org-card-foot">
                <span>{company?.nombre}</span>
                <span>Alta: {new Date(org.created_at).toLocaleDateString('es-MX')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
