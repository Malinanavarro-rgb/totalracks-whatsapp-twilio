import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

const ETIQUETA_ESTADO = { abierto: 'Abierto', en_proceso: 'En proceso', esperando_cliente: 'Esperando al cliente', resuelto: 'Resuelto', cerrado: 'Cerrado' };
const SEVERIDAD_ESTADO = { resuelto: 'success', cerrado: 'success', en_proceso: 'warning', esperando_cliente: 'warning', abierto: 'neutral' };
const SEVERIDAD_PRIORIDAD = { urgente: 'error', alta: 'warning', media: 'neutral', baja: 'neutral' };
const ESTADOS_TICKET = ['abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado'];
const PRIORIDADES_TICKET = ['baja', 'media', 'alta', 'urgente'];

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TicketDetalle() {
  const { ticketId } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  function cargar() {
    api.ticket(ticketId).then(setTicket).catch((e) => setError(e.message));
  }

  useEffect(cargar, [ticketId]);

  async function cambiarEstado(estado) {
    setCambiandoEstado(true);
    setError(null);
    try {
      await api.actualizarEstadoTicket(ticketId, estado);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function cambiarPrioridad(prioridad) {
    setError(null);
    try {
      await api.actualizarTicket(ticketId, { prioridad });
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function enviarComentario(e) {
    e.preventDefault();
    if (!comentario.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await api.comentarTicket(ticketId, comentario.trim());
      setComentario('');
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  if (error && !ticket) return <p className="login-error">{error}</p>;
  if (!ticket) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>{ticket.asunto}</h1>
        <span className={`pill pill--${SEVERIDAD_ESTADO[ticket.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[ticket.estado]}</span>
      </div>

      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>Datos generales</h2>
        <dl className="crm-datos-lista">
          <dt>Cliente</dt><dd>{ticket.cliente_id ? <Link to={`/crm/clientes/${ticket.cliente_id}`}>{ticket.cliente_nombre || `Cliente #${ticket.cliente_id}`}</Link> : '—'}</dd>
          <dt>Teléfono</dt><dd>{ticket.cliente_telefono || '—'}</dd>
          <dt>Proyecto</dt><dd>{ticket.proyecto_id ? <Link to={`/proyectos/${ticket.proyecto_id}`}>Ver proyecto</Link> : '—'}</dd>
          <dt>Categoría</dt><dd>{ticket.categoria}</dd>
          <dt>Prioridad</dt>
          <dd>
            <span className={`pill pill--${SEVERIDAD_PRIORIDAD[ticket.prioridad] || 'neutral'}`}>{ticket.prioridad}</span>
            {' '}
            <select onChange={(e) => e.target.value && cambiarPrioridad(e.target.value)} value="">
              <option value="">Cambiar prioridad…</option>
              {PRIORIDADES_TICKET.filter((p) => p !== ticket.prioridad).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </dd>
          <dt>Creado</dt><dd>{formatearFechaHora(ticket.created_at)}</dd>
        </dl>

        <div className="config-form-inline">
          <select onChange={(e) => e.target.value && cambiarEstado(e.target.value)} value="" disabled={cambiandoEstado}>
            <option value="">Cambiar estado…</option>
            {ESTADOS_TICKET.filter((e) => e !== ticket.estado).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </select>
        </div>
      </section>

      <section className="crm-seccion">
        <h2>Línea de tiempo</h2>
        <ul className="config-kb-lista">
          {ticket.eventos.map((ev) => (
            <li key={ev.id} className="config-kb-item">
              <span className="operaciones-nota">{formatearFechaHora(ev.created_at)}</span> — {ev.texto}
            </li>
          ))}
        </ul>

        <form className="config-form-inline" onSubmit={enviarComentario}>
          <input type="text" placeholder="Agregar comentario…" value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Comentar'}</button>
        </form>
      </section>
    </div>
  );
}
