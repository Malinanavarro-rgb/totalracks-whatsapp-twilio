import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

const ETIQUETA_ESTADO = { abierto: 'Abierto', en_proceso: 'En proceso', esperando_cliente: 'Esperando al cliente', resuelto: 'Resuelto', cerrado: 'Cerrado' };
const SEVERIDAD_ESTADO = { resuelto: 'success', cerrado: 'success', en_proceso: 'warning', esperando_cliente: 'warning', abierto: 'neutral' };
const SEVERIDAD_PRIORIDAD = { urgente: 'error', alta: 'warning', media: 'neutral', baja: 'neutral' };

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Buscador de cliente por nombre (debounced) — mismo filtro que usa Crm.jsx
// (api.clientesCrm({nombre})), sin reinventar un componente de selección.
function BuscadorCliente({ clienteId, onSeleccionar }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);

  useEffect(() => {
    if (!texto.trim() || seleccionado) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.clientesCrm({ nombre: texto.trim() }).then(setResultados).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [texto, seleccionado]);

  return (
    <div>
      <input
        type="text" placeholder="Buscar cliente por nombre…"
        value={seleccionado ? seleccionado.nombre : texto}
        onChange={(e) => { setTexto(e.target.value); setSeleccionado(null); onSeleccionar(null); }}
      />
      {resultados.length > 0 && !seleccionado && (
        <ul className="config-kb-lista">
          {resultados.slice(0, 8).map((c) => (
            <li key={c.id} className="config-kb-item">
              <button type="button" className="boton-enlace" onClick={() => { setSeleccionado(c); setResultados([]); onSeleccionar(c.id); }}>
                {c.nombre} {c.telefono ? `— ${c.telefono}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {clienteId == null && texto.trim() && resultados.length === 0 && <p className="operaciones-nota">Sin coincidencias.</p>}
    </div>
  );
}

function FormNuevoTicket({ onCreado }) {
  const [clienteId, setClienteId] = useState(null);
  const [asunto, setAsunto] = useState('');
  const [categoria, setCategoria] = useState('general');
  const [prioridad, setPrioridad] = useState('media');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    if (!clienteId || !asunto.trim()) { setError('Selecciona un cliente y captura el asunto.'); return; }
    setCreando(true);
    setError(null);
    try {
      const ticket = await api.crearTicket({ clienteId, asunto: asunto.trim(), categoria, prioridad });
      setAsunto('');
      setClienteId(null);
      onCreado(ticket);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <BuscadorCliente clienteId={clienteId} onSeleccionar={setClienteId} />
      <div className="config-form-inline">
        <input type="text" placeholder="Asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="general">General</option>
          <option value="tecnico">Técnico</option>
          <option value="facturacion">Facturación</option>
          <option value="garantia">Garantía</option>
        </select>
        <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
          <option value="baja">Baja</option>
          <option value="media">Media</option>
          <option value="alta">Alta</option>
          <option value="urgente">Urgente</option>
        </select>
        <button type="submit" disabled={creando}>{creando ? 'Creando…' : 'Crear ticket'}</button>
      </div>
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

export default function Tickets() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);

  function cargar() {
    api.tickets({ estado: filtroEstado }).then(setTickets).catch((e) => setError(e.message));
  }

  useEffect(cargar, [filtroEstado]);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Tickets</h1>
        <button type="button" className="boton-enlace" onClick={() => setMostrarForm(!mostrarForm)}>{mostrarForm ? 'Cancelar' : '+ Nuevo ticket'}</button>
      </div>

      {mostrarForm && (
        <section className="crm-seccion">
          <FormNuevoTicket onCreado={() => { setMostrarForm(false); cargar(); }} />
        </section>
      )}

      <div className="config-form-inline">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ETIQUETA_ESTADO).map(([v, etiqueta]) => <option key={v} value={v}>{etiqueta}</option>)}
        </select>
      </div>

      {error && <p className="login-error">{error}</p>}
      {tickets === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {tickets?.length === 0 && <p className="operaciones-nota">Sin tickets.</p>}

      {tickets && tickets.length > 0 && (
        <table>
          <thead>
            <tr><th>Asunto</th><th>Cliente</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>Creado</th></tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td><NavLink to={`/tickets/${t.id}`}>{t.asunto}</NavLink></td>
                <td>{t.cliente_nombre || '—'}</td>
                <td>{t.categoria}</td>
                <td><span className={`pill pill--${SEVERIDAD_PRIORIDAD[t.prioridad] || 'neutral'}`}>{t.prioridad}</span></td>
                <td><span className={`pill pill--${SEVERIDAD_ESTADO[t.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[t.estado]}</span></td>
                <td>{formatearFechaHora(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
