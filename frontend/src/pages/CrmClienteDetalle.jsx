import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

const ESTADOS = ['Nuevo', 'Calificacion', 'Negociacion', 'Calificado', 'Ganado', 'Perdido'];

export default function CrmClienteDetalle() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const [ficha, setFicha] = useState(null);
  const [seguimientos, setSeguimientos] = useState([]);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevoSeguimiento, setNuevoSeguimiento] = useState({ texto: '', fecha_programada: '', prioridad: 'media' });
  const [etapasPipeline, setEtapasPipeline] = useState([]);
  const [nuevaOportunidad, setNuevaOportunidad] = useState({ estado: 'Nuevo', descripcion: '', presupuesto_estimado: '' });

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

  useEffect(() => {
    api.pipelineEtapas().then((etapas) => setEtapasPipeline(etapas.filter((et) => et.activo)));
  }, []);

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

  async function eliminarClienteActual() {
    try {
      await api.eliminarClienteCrm(clienteId);
      navigate('/crm');
    } catch (e2) {
      setError(e2.message);
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

  async function agregarOportunidad(e) {
    e.preventDefault();
    if (!nuevaOportunidad.descripcion.trim()) return;
    try {
      await api.crearOportunidad(clienteId, {
        estado:               nuevaOportunidad.estado,
        descripcion:          nuevaOportunidad.descripcion.trim(),
        presupuesto_estimado: nuevaOportunidad.presupuesto_estimado ? Number(nuevaOportunidad.presupuesto_estimado) : null,
      });
      setNuevaOportunidad({ estado: 'Nuevo', descripcion: '', presupuesto_estimado: '' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function actualizarEstadoOportunidad(oportunidadId, estado) {
    try {
      await api.actualizarOportunidad(oportunidadId, { estado });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminarOportunidad(oportunidadId) {
    try {
      await api.eliminarOportunidad(oportunidadId);
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
          {!editando && (
            <div>
              <button onClick={() => setEditando(true)}>Editar</button>
              {' '}
              <button onClick={eliminarClienteActual}>Eliminar cliente</button>
            </div>
          )}
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

      <section className="crm-seccion">
        <h2>Oportunidades</h2>
        <form className="crm-form-seguimiento" onSubmit={agregarOportunidad}>
          <input
            type="text" placeholder="Descripción de la oportunidad…"
            value={nuevaOportunidad.descripcion}
            onChange={(e) => setNuevaOportunidad({ ...nuevaOportunidad, descripcion: e.target.value })}
          />
          <input
            type="number" min="0" placeholder="Presupuesto estimado"
            value={nuevaOportunidad.presupuesto_estimado}
            onChange={(e) => setNuevaOportunidad({ ...nuevaOportunidad, presupuesto_estimado: e.target.value })}
          />
          <select
            value={nuevaOportunidad.estado}
            onChange={(e) => setNuevaOportunidad({ ...nuevaOportunidad, estado: e.target.value })}
          >
            {etapasPipeline.map((et) => <option key={et.id} value={et.nombre}>{et.nombre}</option>)}
          </select>
          <button type="submit">Agregar</button>
        </form>

        {oportunidades.length === 0 ? (
          <p className="operaciones-nota">Sin oportunidades.</p>
        ) : (
          <ul className="crm-oportunidades-lista">
            {oportunidades.map((op) => (
              <li key={op.id}>
                {op.descripcion || op.tipo_rack || 'Sin descripción'}
                {op.presupuesto_estimado ? ` — $${op.presupuesto_estimado}` : ''}
                <select value={op.estado || 'Nuevo'} onChange={(e) => actualizarEstadoOportunidad(op.id, e.target.value)}>
                  {etapasPipeline.map((et) => <option key={et.id} value={et.nombre}>{et.nombre}</option>)}
                </select>
                <button onClick={() => eliminarOportunidad(op.id)}>Eliminar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
