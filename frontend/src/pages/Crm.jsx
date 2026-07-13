import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Fase 5: lista de clientes. La ficha completa (conversaciones + citas +
// oportunidades + seguimientos) vive en /crm/clientes/:id.
export default function Crm() {
  const [clientes, setClientes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.clientesCrm().then(setClientes).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>CRM</h1>
        <NavLink to="/crm/pipeline">Ver pipeline</NavLink>
      </div>
      {error && <p className="login-error">{error}</p>}
      {clientes === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {clientes?.length === 0 && <p className="operaciones-nota">No hay clientes todavía.</p>}

      {clientes && clientes.length > 0 && (
        <ul className="conversaciones-lista">
          {clientes.map((c) => (
            <NavLink key={c.id} to={`/crm/clientes/${c.id}`} className="conversacion-item">
              <div className="conversacion-item-encabezado">
                <strong>{c.nombre || c.telefono}</strong>
                <span className="etiqueta-atencion">{c.estado || 'Nuevo'}</span>
              </div>
              <p className="conversacion-item-preview">
                {c.empresa ? `${c.empresa} · ` : ''}{c.telefono}
              </p>
            </NavLink>
          ))}
        </ul>
      )}
    </div>
  );
}
