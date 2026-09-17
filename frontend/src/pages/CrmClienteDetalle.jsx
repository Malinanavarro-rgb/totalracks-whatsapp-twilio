import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ESTADOS = ['Nuevo', 'Calificacion', 'Negociacion', 'Calificado', 'Ganado', 'Perdido'];
const RAZONES_PERDIDA = ['Precio', 'Competencia', 'No responde', 'Sin presupuesto', 'No califica', 'Proyecto pospuesto', 'No autorizado', 'Otro'];
// Mismo criterio que Shell.jsx — el frontend no importa modules/permisos.js
// del backend, así que este arreglo vive duplicado a propósito.
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

export default function CrmClienteDetalle() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const esDemo = !!sesion?.empresaActiva?.es_demo;
  const [confirmandoBorradoTotal, setConfirmandoBorradoTotal] = useState(false);
  const [borrandoTodo, setBorrandoTodo] = useState(false);
  const [ficha, setFicha] = useState(null);
  const [seguimientos, setSeguimientos] = useState([]);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevoSeguimiento, setNuevoSeguimiento] = useState({ texto: '', fecha_programada: '', prioridad: 'media' });
  const [etapasPipeline, setEtapasPipeline] = useState([]);
  const [nuevaOportunidad, setNuevaOportunidad] = useState({ estado: 'Nuevo', descripcion: '', presupuesto_estimado: '' });
  const [asesores, setAsesores] = useState([]);
  const [mostrarNuevaCita, setMostrarNuevaCita] = useState(false);
  const [nuevaCita, setNuevaCita] = useState({ asesorId: '', fecha: '', hora: '09:00', duracionMinutos: 30 });
  const editandoRef = useRef(editando);
  editandoRef.current = editando;
  const [preguntaTara, setPreguntaTara] = useState('');
  const [respuestaTara, setRespuestaTara] = useState(null);
  const [preguntandoTara, setPreguntandoTara] = useState(false);
  // Centro de Conocimiento, Fase 3 — "Ayúdame a cerrar" por oportunidad,
  // keyed por id para poder tener varias abiertas a la vez sin pisarse.
  const [ayudaCierre, setAyudaCierre] = useState({});
  // Quick win (auditoría 2026-09-16) — razon_cierre al marcar Perdido.
  const [pidiendoRazonPerdida, setPidiendoRazonPerdida] = useState(null); // oportunidadId o null
  const [razonPerdida, setRazonPerdida] = useState('');

  function cargar() {
    Promise.all([api.fichaCliente(clienteId), api.seguimientos(clienteId)])
      .then(([f, s]) => {
        setFicha(f);
        setSeguimientos(s);
        // No pisar el formulario si el usuario está editando en este momento
        // (Fase Demo Comercial: el auto-refresh no debe borrar lo que se
        // está escribiendo).
        if (!editandoRef.current) {
          setForm({
            nombre:  f.cliente.nombre || '',
            empresa: f.cliente.empresa || '',
            ciudad:  f.cliente.ciudad || '',
            notas:   f.cliente.notas || '',
            estado:  f.cliente.estado || 'Nuevo',
          });
        }
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [clienteId]);

  // Fase Demo Comercial: la ficha se actualiza sola mientras el cliente
  // conversa por WhatsApp — nueva conversación, oportunidad, datos capturados.
  useEffect(() => {
    const id = setInterval(cargar, 4000);
    return () => clearInterval(id);
  }, [clienteId]);

  useEffect(() => {
    api.pipelineEtapas().then((etapas) => setEtapasPipeline(etapas.filter((et) => et.activo)));
    api.asesores().then(setAsesores).catch(() => {});
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

  // Borrado completo — solo empresas demo (Panel de Cotizaciones, 2026-08-10).
  // Confirmación en dos pasos (no un solo click) porque esto SÍ borra
  // conversaciones/citas/oportunidades/cotizaciones reales de ese cliente,
  // a diferencia de "Eliminar cliente" arriba (que ya rechaza si hay
  // cualquier historial).
  async function borrarTodoElHistorial() {
    setBorrandoTodo(true);
    try {
      await api.eliminarClienteCompleto(clienteId);
      navigate('/crm');
    } catch (e2) {
      setError(e2.message);
      setBorrandoTodo(false);
      setConfirmandoBorradoTotal(false);
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

  async function actualizarEstadoOportunidad(oportunidadId, estado, razon_cierre) {
    try {
      await api.actualizarOportunidad(oportunidadId, razon_cierre !== undefined ? { estado, razon_cierre } : { estado });
      setPidiendoRazonPerdida(null);
      setRazonPerdida('');
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  // Quick win (auditoría 2026-09-16, sección N.2): razon_cierre ya existía en
  // DB y en la whitelist del backend, solo faltaba pedirla desde la UI al
  // marcar una oportunidad como Perdido — nunca se guardaba antes de esto.
  function elegirEstadoOportunidad(oportunidadId, estado) {
    if (estado === 'Perdido') {
      setPidiendoRazonPerdida(oportunidadId);
      setRazonPerdida('');
      return;
    }
    actualizarEstadoOportunidad(oportunidadId, estado);
  }

  async function eliminarOportunidad(oportunidadId) {
    try {
      await api.eliminarOportunidad(oportunidadId);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function ayudameACerrar(oportunidadId) {
    setAyudaCierre((prev) => ({ ...prev, [oportunidadId]: { cargando: true, resultado: null, error: null } }));
    try {
      const resultado = await api.ayudameACerrar(oportunidadId);
      setAyudaCierre((prev) => ({ ...prev, [oportunidadId]: { cargando: false, resultado, error: null } }));
    } catch (e2) {
      setAyudaCierre((prev) => ({ ...prev, [oportunidadId]: { cargando: false, resultado: null, error: e2.message } }));
    }
  }

  async function crearCitaActual(e) {
    e.preventDefault();
    if (!nuevaCita.fecha) return;
    try {
      const inicio = new Date(`${nuevaCita.fecha}T${nuevaCita.hora}:00`);
      const fin = new Date(inicio.getTime() + nuevaCita.duracionMinutos * 60000);
      await api.crearCita({
        clienteId, asesorId: nuevaCita.asesorId || undefined,
        inicio: inicio.toISOString(), fin: fin.toISOString(),
      });
      setMostrarNuevaCita(false);
      setNuevaCita({ asesorId: '', fecha: '', hora: '09:00', duracionMinutos: 30 });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function cancelarCitaActual(citaId) {
    try {
      await api.cancelarCita(citaId);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function tomarConversacionActual() {
    try {
      await api.tomarConversacion(clienteId);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function preguntarATara(e) {
    e.preventDefault();
    if (!preguntaTara.trim() || preguntandoTara) return;
    setPreguntandoTara(true);
    setRespuestaTara(null);
    try {
      const { respuesta } = await api.preguntarSobreCliente(clienteId, preguntaTara.trim());
      setRespuestaTara(respuesta);
    } catch (e2) {
      setRespuestaTara(`No pude responder: ${e2.message}`);
    } finally {
      setPreguntandoTara(false);
    }
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!ficha) return <p className="operaciones-nota">Cargando…</p>;

  const { cliente, historial, citas, oportunidades } = ficha;

  return (
    <div>
      <p><Link to="/crm">&larr; Volver</Link></p>
      <h1>{cliente.nombre || cliente.telefono}</h1>

      <section className="crm-seccion pregunta-tara-ficha">
        <h2>Pregúntale a TARA sobre {cliente.nombre || 'este cliente'}</h2>
        <form className="config-form-inline" onSubmit={preguntarATara}>
          <input
            type="text" value={preguntaTara} onChange={(e) => setPreguntaTara(e.target.value)}
            placeholder="¿Qué pasó con este cliente? ¿Ya puedo enviar la cotización?"
            disabled={preguntandoTara}
          />
          <button type="submit" disabled={preguntandoTara || !preguntaTara.trim()}>
            {preguntandoTara ? 'Pensando…' : 'Preguntar'}
          </button>
        </form>
        {respuestaTara && <p className="pregunta-tara-respuesta-ficha">{respuestaTara}</p>}
      </section>

      <section className="crm-seccion">
        <div className="crm-seccion-header">
          <h2>Datos generales</h2>
          {!editando && (
            <div>
              <button onClick={() => setEditando(true)}>Editar</button>
              {' '}
              <button onClick={eliminarClienteActual}>Eliminar cliente</button>
              {esGerencial && esDemo && (
                <>
                  {' '}
                  <button type="button" onClick={() => setConfirmandoBorradoTotal(true)}>
                    Borrar todo el historial
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {esGerencial && esDemo && confirmandoBorradoTotal && (
          <p className="login-error">
            Esto borra TODO — conversaciones, mensajes, citas, oportunidades, cotizaciones y logs de{' '}
            <strong>{cliente.nombre || cliente.telefono}</strong> ({cliente.telefono}). Es irreversible.{' '}
            <button type="button" disabled={borrandoTodo} onClick={borrarTodoElHistorial}>
              {borrandoTodo ? 'Borrando…' : 'Sí, borrar todo'}
            </button>{' '}
            <button type="button" disabled={borrandoTodo} onClick={() => setConfirmandoBorradoTotal(false)}>Cancelar</button>
          </p>
        )}

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
            <dt>Score de interés</dt><dd>{cliente.score_interes != null ? cliente.score_interes : '—'}</dd>
            <dt>Notas</dt><dd>{cliente.notas || '—'}</dd>
            <dt>Atendido por</dt><dd>{cliente.atendido_por === 'humano' ? 'Atención personal' : 'TARA'}</dd>
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
        <div className="crm-seccion-header">
          <h2>Citas</h2>
          <button onClick={() => setMostrarNuevaCita(!mostrarNuevaCita)}>{mostrarNuevaCita ? 'Cancelar' : 'Nueva cita'}</button>
        </div>

        {mostrarNuevaCita && (
          <form className="config-form-inline" onSubmit={crearCitaActual}>
            <select value={nuevaCita.asesorId} onChange={(e) => setNuevaCita({ ...nuevaCita, asesorId: e.target.value })}>
              <option value="">Automático</option>
              {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <input type="date" required value={nuevaCita.fecha} onChange={(e) => setNuevaCita({ ...nuevaCita, fecha: e.target.value })} />
            <input type="time" required value={nuevaCita.hora} onChange={(e) => setNuevaCita({ ...nuevaCita, hora: e.target.value })} />
            <input
              type="number" min="5" step="5" placeholder="Minutos"
              value={nuevaCita.duracionMinutos}
              onChange={(e) => setNuevaCita({ ...nuevaCita, duracionMinutos: Number(e.target.value) })}
            />
            <button type="submit">Guardar</button>
          </form>
        )}

        {citas.length === 0 ? (
          <p className="operaciones-nota">Sin citas.</p>
        ) : (
          <ul className="agenda-citas-lista">
            {citas.map((cita) => (
              <li key={cita.id} className="agenda-cita-item">
                <span>{new Date(cita.inicio).toLocaleString('es-MX')}</span>
                <span>{cita.asesores?.nombre || 'Sin asignar'}</span>
                <span className={`agenda-estado agenda-estado--${cita.estado}`}>{cita.estado}</span>
                {cita.estado !== 'cancelada' && <button onClick={() => cancelarCitaActual(cita.id)}>Cancelar</button>}
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
                {op.estado === 'Perdido' && op.razon_cierre && (
                  <span className="operaciones-nota"> — motivo: {op.razon_cierre}</span>
                )}
                <select value={op.estado || 'Nuevo'} onChange={(e) => elegirEstadoOportunidad(op.id, e.target.value)}>
                  {etapasPipeline.map((et) => <option key={et.id} value={et.nombre}>{et.nombre}</option>)}
                </select>
                <button onClick={() => ayudameACerrar(op.id)} disabled={ayudaCierre[op.id]?.cargando}>
                  {ayudaCierre[op.id]?.cargando ? 'Analizando…' : 'Ayúdame a cerrar'}
                </button>
                <button onClick={() => eliminarOportunidad(op.id)}>Eliminar</button>

                {pidiendoRazonPerdida === op.id && (
                  <p className="config-form-inline">
                    <select value={razonPerdida} onChange={(e) => setRazonPerdida(e.target.value)}>
                      <option value="">¿Por qué se perdió?</option>
                      {RAZONES_PERDIDA.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button type="button" disabled={!razonPerdida} onClick={() => actualizarEstadoOportunidad(op.id, 'Perdido', razonPerdida)}>
                      Confirmar
                    </button>
                    <button type="button" onClick={() => setPidiendoRazonPerdida(null)}>Cancelar</button>
                  </p>
                )}

                {ayudaCierre[op.id]?.error && (
                  <p className="login-error">{ayudaCierre[op.id].error}</p>
                )}
                {ayudaCierre[op.id]?.resultado && (
                  <div className="pregunta-tara-respuesta">
                    <p>{ayudaCierre[op.id].resultado.resumen}</p>
                    {ayudaCierre[op.id].resultado.riesgos?.length > 0 && (
                      <p><strong>Riesgos:</strong> {ayudaCierre[op.id].resultado.riesgos.join(' · ')}</p>
                    )}
                    {ayudaCierre[op.id].resultado.proxima_accion && (
                      <p><strong>Próxima acción:</strong> {ayudaCierre[op.id].resultado.proxima_accion}</p>
                    )}
                    {ayudaCierre[op.id].resultado.respuesta_recomendada && (
                      <p><strong>Mensaje sugerido:</strong> {ayudaCierre[op.id].resultado.respuesta_recomendada}</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-seccion">
        <div className="crm-seccion-header">
          <h2>Conversación</h2>
          <div>
            {cliente.atendido_por === 'ia' && <button onClick={tomarConversacionActual}>Tomar conversación</button>}
            {' '}
            <Link to={`/conversaciones/${clienteId}`}>Ver y responder &rarr;</Link>
          </div>
        </div>
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
