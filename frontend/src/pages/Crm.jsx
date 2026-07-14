import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Fase 5: lista de clientes. La ficha completa (conversaciones + citas +
// oportunidades + seguimientos) vive en /crm/clientes/:id.
// Pivote a producto, Fase 2.4: búsqueda/filtros resueltos server-side
// (modules/crm-ui.js::listarClientes) — con debounce simple para no
// disparar una consulta por cada tecla.
export default function Crm() {
  const [clientes, setClientes] = useState(null);
  const [error, setError] = useState(null);
  const [filtros, setFiltros] = useState({ nombre: '', estado: '', score_min: '' });
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ telefono: '', nombre: '', empresa: '' });

  useEffect(() => {
    const timeout = setTimeout(() => {
      api.clientesCrm(filtros).then(setClientes).catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timeout);
  }, [filtros]);

  async function crearCliente(e) {
    e.preventDefault();
    if (!nuevoCliente.telefono.trim()) return;
    try {
      await api.crearClienteManual(nuevoCliente);
      setNuevoCliente({ telefono: '', nombre: '', empresa: '' });
      setMostrarNuevo(false);
      api.clientesCrm(filtros).then(setClientes);
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Ventas</h1>
        <div>
          <button onClick={() => setMostrarNuevo(!mostrarNuevo)}>{mostrarNuevo ? 'Cancelar' : 'Nuevo cliente'}</button>
          {' '}
          <NavLink to="/crm/pipeline">Ver proceso comercial</NavLink>
        </div>
      </div>

      {mostrarNuevo && (
        <form className="config-form-inline" onSubmit={crearCliente}>
          <input
            type="text" placeholder="Teléfono (con código de país)" required
            value={nuevoCliente.telefono} onChange={(e) => setNuevoCliente({ ...nuevoCliente, telefono: e.target.value })}
          />
          <input
            type="text" placeholder="Nombre"
            value={nuevoCliente.nombre} onChange={(e) => setNuevoCliente({ ...nuevoCliente, nombre: e.target.value })}
          />
          <input
            type="text" placeholder="Empresa (opcional)"
            value={nuevoCliente.empresa} onChange={(e) => setNuevoCliente({ ...nuevoCliente, empresa: e.target.value })}
          />
          <button type="submit">Crear</button>
        </form>
      )}

      <form className="config-form-inline" onSubmit={(e) => e.preventDefault()}>
        <input
          type="text" placeholder="Buscar por nombre o teléfono…"
          value={filtros.nombre} onChange={(e) => setFiltros({ ...filtros, nombre: e.target.value })}
        />
        <input
          type="text" placeholder="Estado exacto (ej. Nuevo)"
          value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
        />
        <input
          type="number" min="0" max="100" placeholder="Score mínimo"
          value={filtros.score_min} onChange={(e) => setFiltros({ ...filtros, score_min: e.target.value })}
        />
      </form>

      {error && <p className="login-error">{error}</p>}
      {clientes === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {clientes?.length === 0 && <p className="operaciones-nota">No hay clientes que coincidan.</p>}

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
