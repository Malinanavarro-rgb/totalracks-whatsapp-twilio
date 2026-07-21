import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

const CANALES = [{ v: '', l: 'Todos los canales' }, { v: 'whatsapp', l: 'WhatsApp' }, { v: 'facebook', l: 'Facebook' }, { v: 'instagram', l: 'Instagram' }];
const ESTADOS  = [{ v: '', l: 'Todos los estados' }, { v: 'abierta', l: 'Abierta' }, { v: 'seguimiento', l: 'Seguimiento' }, { v: 'cerrada', l: 'Cerrada' }];
const PRIORIDADES = [{ v: '', l: 'Toda prioridad' }, { v: 'urgente', l: 'Urgente' }, { v: 'alta', l: 'Alta' }, { v: 'normal', l: 'Normal' }, { v: 'baja', l: 'Baja' }];

function formatearFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  return esHoy ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

// Inbox Inteligente (v0.4) — Zona 1: Sidebar. Convive con /conversaciones
// (sin tocarla) mientras el Inbox nuevo gana las demás zonas.
export default function Inbox() {
  const [filtros, setFiltros] = useState({ canal: '', estado: '', prioridad: '' });
  const [hilos, setHilos] = useState(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback((filtrosActuales, cursor) => {
    const peticion = api.hilosInbox({ ...filtrosActuales, cursor });
    return peticion;
  }, []);

  useEffect(() => {
    setHilos(null);
    setHayMas(true);
    setError(null);
    cargar(filtros).then((datos) => {
      setHilos(datos);
      setHayMas(datos.length === 30);
    }).catch((e) => setError(e.message));
  }, [filtros, cargar]);

  function actualizarFiltro(campo, valor) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  async function cargarMas() {
    if (!hilos || hilos.length === 0) return;
    setCargandoMas(true);
    try {
      const cursor = hilos[hilos.length - 1].ultimo_mensaje_at;
      const mas = await cargar(filtros, cursor);
      setHilos((h) => [...h, ...mas]);
      setHayMas(mas.length === 30);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargandoMas(false);
    }
  }

  return (
    <div>
      <h1>Inbox</h1>

      <div className="inbox-filtros">
        <select value={filtros.canal} onChange={(e) => actualizarFiltro('canal', e.target.value)}>
          {CANALES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
        <select value={filtros.estado} onChange={(e) => actualizarFiltro('estado', e.target.value)}>
          {ESTADOS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select value={filtros.prioridad} onChange={(e) => actualizarFiltro('prioridad', e.target.value)}>
          {PRIORIDADES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </div>

      {error && <p className="login-error">No se pudo cargar el Inbox: {error}</p>}
      {hilos === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {hilos?.length === 0 && <p className="operaciones-nota">No hay conversaciones con estos filtros.</p>}

      {hilos && hilos.length > 0 && (
        <>
          <ul className="conversaciones-lista">
            {hilos.map((h) => (
              <NavLink key={h.id} to={`/inbox/${h.id}`} className="conversacion-item">
                <div className="conversacion-item-encabezado">
                  <strong>{h.clientes?.nombre && h.clientes.nombre !== 'Sin nombre' ? h.clientes.nombre : (h.clientes?.telefono || 'Sin nombre')}</strong>
                  <span className="inbox-fecha">{formatearFecha(h.ultimo_mensaje_at)}</span>
                </div>
                <p className="conversacion-item-preview">{h.ultimo_mensaje_preview || 'Sin mensajes'}</p>
                <div className="inbox-badges">
                  <span className="inbox-badge inbox-badge--canal">{h.canal}</span>
                  <span className={`inbox-badge inbox-badge--estado-${h.estado}`}>{h.estado}</span>
                  <span className={`inbox-badge inbox-badge--prioridad-${h.prioridad}`}>{h.prioridad}</span>
                  <span className={`etiqueta-atencion etiqueta-atencion--${h.clientes?.atendido_por}`}>
                    {h.clientes?.atendido_por === 'humano' ? 'Atención personal' : 'TARA'}
                  </span>
                  {(h.etiquetas || []).map(et => <span key={et} className="inbox-badge inbox-badge--etiqueta">{et}</span>)}
                </div>
              </NavLink>
            ))}
          </ul>

          {hayMas && (
            <button type="button" className="inbox-cargar-mas" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? 'Cargando…' : 'Cargar más'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
