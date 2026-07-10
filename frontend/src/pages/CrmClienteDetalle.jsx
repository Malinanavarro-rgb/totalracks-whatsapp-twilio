import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

const ESTADOS = ['Nuevo', 'Calificacion', 'Negociacion', 'Calificado', 'Ganado', 'Perdido'];

export default function CrmClienteDetalle() {
  const { clienteId } = useParams();
  const [ficha, setFicha] = useState(null);
  const [seguimientos, setSeguimientos] = useState([]);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevoSeguimiento, setNuevoSeguimiento] = useState({ texto: '', fecha_programada: '', prioridad: 'media' });

  function cargar() {
    Promise.all([api.fichaCliente(clienteId), api.seguimientos(clienteId)])
      .then(([f, s]) => {
        setFicha(f);
        setSeguimientos(s);
        setForm({
          nombre:  f.cliente.nombre || '',
          empresa: f.cliente.empresa || '',
          ciudad:  f.cliente.ciudad || '',
          notas:   f.cliente.notas || '',
          estado:  f.cliente.estado || 'Nuevo',
        });
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [clienteId]);

  async function guardarEdicion(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.actualizarCliente(clienteId, form);
      setEditando(false);
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  async function agregarSeguimiento(e) {
    e.preventDefault();
    if (!nuevoSeguimiento.texto.trim()) return;
    try {
      await api.crearSeguimiento(clienteId, nuevoSeguimiento);
      setNuevoSeguimiento({ texto: '', fecha_programada: '', prioridad: 'media' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleCompletado(seguimiento) {
    try {
      await api.actualizarSeguimiento(seguimiento.id, { completado: !seguimiento.completado });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!ficha) return <p className="operaciones-nota">Cargando…</p>;

  const { cliente, historial, citas, oportunidades } = ficha;

  return (
    <div>
      <p><Link to="/crm">&larr; CRM</Link></p>
      <h1>{cliente.nombre || cliente.telefono}</h1>

      <section className="crm-seccion">
        <div className="crm-seccion-header">
          <h2>Datos generales</h2>
          {!editando && <button onClick={() => setEditando(true)}>Editar</button>}
        </div>

        {editando ? (
          <form className="crm-form-edicion" onSubmit={guardarEdicion}>
            <label>Nombre <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
            <label>Empresa <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></label>
            <label>Ciudad <input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} /></label>
            <label>Notas <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></label>
            <label>
              Estado
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                {ESTADOS.map((es) => <option key={es} value={es}>{es}</option>)}
              </select>
            </label>
            <div className="modal-acciones">
              <button type="button" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
              <button type="submit" disabled={guardando}>Guardar</button>
            </div>
          </form>
        ) : (
          <dl className="crm-datos-lista">
            <dt>Teléfono</dt><dd>{cliente.telefono}</dd>
            <dt>Empresa</dt><dd>{cliente.empresa || '—'}</dd>
            <dt>Ciudad</dt><dd>{cliente.ciudad || '—'}</dd>
            <dt>Estado</dt><dd>{cliente.estado || 'Nuevo'}</dd>
            <dt>Notas</dt><dd>{cliente.notas || '—'}</dd>
            <dt>Atendido por</dt><dd>{cliente.atendido_por === 'humano' ? 'Humano' : 'TARA'}</dd>
          </dl>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Seguimientos</h2>
        <form className="crm-form-seguimiento" onSubmit={agregarSeguimiento}>
          <input
            type="text" placeholder="Nuevo seguimiento…"
            value={nuevoSeguimiento.texto}
            onChange={(e) => setNuevoSeguimiento({ ...nuevoSeguimiento, texto: e.target.value })}
          />
          <input
            type="date"
            value={nuevoSeguimiento.fecha_programada}
            onChange={(e) => setNuevoSeguimiento({ ...nuevoSeguimiento, fecha_programada: e.target.value })}
          />
          <select
            value={nuevoSeguimiento.prioridad}
            onChange={(e) => setNuevoSeguimiento({ ...nuevoSeguimiento, prioridad: e.target.value })}
          >
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
          <button type="submit">Agregar</button>
        </form>

        {seguimientos.length === 0 ? (
          <p className="operaciones-nota">Sin seguimientos.</p>
        ) : (
          <ul className="crm-seguimientos-lista">
            {seguimientos.map((s) => (
              <li key={s.id} className={`crm-seguimiento-item ${s.completado ? 'crm-seguimiento-item--completado' : ''}`}>
                <input type="checkbox" checked={s.completado} onChange={() => toggleCompletado(s)} />
                <span className={`etiqueta-prioridad etiqueta-prioridad--${s.prioridad}`}>{s.prioridad}</span>
                <span className="crm-seguimiento-texto">{s.texto}</span>
                {s.fecha_programada && <span className="crm-seguimiento-fecha">{s.fecha_programada}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Citas</h2>
        {citas.length === 0 ? (
          <p className="operaciones-nota">Sin citas.</p>
        ) : (
          <ul className="agenda-citas-lista">
            {citas.map((cita) => (
              <li key={cita.id} className="agenda-cita-item">
                <span>{new Date(cita.inicio).toLocaleString('es-MX')}</span>
                <span>{cita.asesores?.nombre || 'Sin asignar'}</span>
                <span className={`agenda-estado agenda-estado--${cita.estado}`}>{cita.estado}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {oportunidades.length > 0 && (
        <section className="crm-seccion">
          <h2>Oportunidades</h2>
          <ul className="crm-oportunidades-lista">
            {oportunidades.map((op) => (
              <li key={op.id}>{op.descripcion} — <em>{op.estado}</em></li>
            ))}
          </ul>
        </section>
      )}

      <section className="crm-seccion">
        <h2>Conversación</h2>
        {historial.length === 0 ? (
          <p className="operaciones-nota">Sin mensajes.</p>
        ) : (
          <div className="historial-mensajes">
            {historial.map((m, i) => (
              <div key={i} className={`mensaje-burbuja mensaje-burbuja--${m.de}`}>
                <span className="mensaje-texto">{m.texto}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
