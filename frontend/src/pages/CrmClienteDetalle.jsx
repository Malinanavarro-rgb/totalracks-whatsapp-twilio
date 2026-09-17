import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ESTADOS = ['Nuevo', 'Calificacion', 'Negociacion', 'Calificado', 'Ganado', 'Perdido'];
const RAZONES_PERDIDA = ['Precio', 'Competencia', 'No responde', 'Sin presupuesto', 'No califica', 'Proyecto pospuesto', 'No autorizado', 'Otro'];
// Mismo criterio que Shell.jsx — el frontend no importa modules/permisos.js
// del backend, así que este arreglo vive duplicado a propósito.
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];
const ESTADOS_CERRADOS = ['Perdido', 'Cerrado', 'Ganado'];

// Expediente Solar 360° (auditoría 2026-09-16, Parte A) — tabs en vez de una
// página interminable. Cada tab reusa datos/funciones que ya existían;
// donde el dato genuinamente no se captura todavía (datos técnicos del
// inmueble, documentos clasificados), se dice honestamente en vez de
// inventar una sección vacía disfrazada de completa.
const TABS = [
  { id: 'resumen', etiqueta: 'Resumen' },
  { id: 'consumo', etiqueta: 'Consumo' },
  { id: 'proyecto', etiqueta: 'Proyecto solar' },
  { id: 'cotizaciones', etiqueta: 'Cotizaciones' },
  { id: 'conversacion', etiqueta: 'Conversación' },
  { id: 'documentos', etiqueta: 'Documentos' },
  { id: 'operacion', etiqueta: 'Operación' },
  { id: 'historial', etiqueta: 'Historial' },
];

function scoreBadge(score) {
  if (score == null) return { texto: 'Sin datos de intención', clase: 'neutral' };
  if (score === 0) return { texto: 'Nuevo — sin interacciones todavía', clase: 'neutral' };
  if (score >= 70) return { texto: `🔥 ${score} Alta intención`, clase: 'success' };
  if (score >= 40) return { texto: `⚡ ${score} Intención media`, clase: 'warning' };
  return { texto: `${score} Baja intención`, clase: 'neutral' };
}

function formatearFechaHora(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

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
  const [cotizaciones, setCotizaciones] = useState(null);
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
  // Expediente Solar 360° — tab activo + subida manual de recibo CFE.
  const [tabActiva, setTabActiva] = useState('resumen');
  const [subiendoRecibo, setSubiendoRecibo] = useState(false);
  const [borradorRecibo, setBorradorRecibo] = useState(null); // datos extraídos, sin guardar todavía
  const [erroRecibo, setErrorRecibo] = useState(null);

  function cargar() {
    Promise.all([api.fichaCliente(clienteId), api.seguimientos(clienteId), api.cotizaciones(clienteId)])
      .then(([f, s, c]) => {
        setFicha(f);
        setSeguimientos(s);
        setCotizaciones(c);
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

  // Expediente Solar 360° — subida manual de recibo CFE. Nunca guarda solo:
  // el asesor revisa/corrige el borrador extraído antes de confirmarlo con
  // el PATCH de oportunidad que ya existe (nunca se asume OCR infalible).
  async function subirRecibo(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendoRecibo(true);
    setErrorRecibo(null);
    setBorradorRecibo(null);
    try {
      const datos = await api.subirReciboCFE(clienteId, archivo);
      setBorradorRecibo(datos);
    } catch (e2) {
      setErrorRecibo(e2.message);
    } finally {
      setSubiendoRecibo(false);
    }
  }

  async function confirmarRecibo() {
    if (!oportunidadPrincipal) { setErrorRecibo('Este cliente no tiene una oportunidad abierta donde guardar estos datos — créala primero en el tab Resumen.'); return; }
    try {
      await api.actualizarOportunidad(oportunidadPrincipal.id, {
        recibo_cfe_recibido: true,
        consumo_mensual_kwh: borradorRecibo.consumoMensualKwh ?? undefined,
        importe_promedio_recibo: borradorRecibo.importePromedioRecibo ?? undefined,
        tarifa_cfe: borradorRecibo.tarifa ?? undefined,
      });
      setBorradorRecibo(null);
      cargar();
    } catch (e2) {
      setErrorRecibo(e2.message);
    }
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!ficha) return <p className="operaciones-nota">Cargando…</p>;

  const { cliente, historial, citas, oportunidades } = ficha;
  const oportunidadPrincipal = oportunidades.find((op) => !ESTADOS_CERRADOS.includes(op.estado)) || oportunidades[0] || null;
  const score = scoreBadge(cliente.score_interes);
  const ultimoMensaje = historial[historial.length - 1];
  const proximoSeguimiento = seguimientos.filter((s) => !s.completado && s.fecha_programada).sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada))[0];
  const tieneCotizacion = (cotizaciones?.length || 0) > 0;
  const proximaCita = citas.find((c) => ['agendada', 'confirmada'].includes(c.estado));
  // Resuelto client-side contra la lista de asesores ya cargada — la
  // relación clientes.asesor_id → asesores no la reconoce PostgREST hoy
  // (verificado en vivo), así que no se puede pedir con un embed del lado
  // del servidor sin arreglar antes esa relación.
  const nombreAsesor = asesores.find((a) => a.id === cliente.asesor_id)?.nombre;

  function irATab(id) { setTabActiva(id); }

  return (
    <div>
      <p><Link to="/crm">&larr; Volver</Link></p>

      {/* Encabezado resumen — Expediente Solar 360°, Parte A de la auditoría 2026-09-16 */}
      <section className="expediente-encabezado">
        <div className="expediente-encabezado-titulo">
          <h1>{cliente.nombre || cliente.telefono}</h1>
          <span className={`pill pill--${score.clase}`}>{score.texto}</span>
        </div>
        <p className="operaciones-nota">
          {[cliente.ciudad, oportunidadPrincipal?.tipo_propiedad, cliente.fuente].filter(Boolean).join(' · ') || 'Sin más datos de contexto todavía'}
        </p>

        <div className="expediente-encabezado-datos">
          <div><dt>Etapa</dt><dd>{oportunidadPrincipal?.estado || cliente.estado || 'Nuevo'}</dd></div>
          <div><dt>Asesor</dt><dd>{nombreAsesor || 'Sin asignar'}</dd></div>
          <div><dt>Último contacto</dt><dd>{formatearFechaHora(ultimoMensaje?.fecha) || 'Sin conversación'}</dd></div>
          <div><dt>Próxima acción</dt><dd>{oportunidadPrincipal?.siguiente_accion || (proximoSeguimiento ? `${proximoSeguimiento.texto} (${proximoSeguimiento.fecha_programada})` : '—')}</dd></div>
        </div>

        <div className="expediente-checklist">
          <span className={`pill pill--${oportunidadPrincipal?.recibo_cfe_recibido ? 'success' : 'neutral'}`}>Recibo {oportunidadPrincipal?.recibo_cfe_recibido ? '✓' : '—'}</span>
          <span className={`pill pill--${tieneCotizacion ? 'success' : 'neutral'}`}>Cotización {tieneCotizacion ? '✓' : '—'}</span>
          <span className="pill pill--neutral">Visita {proximaCita ? proximaCita.estado : (oportunidadPrincipal?.estado_visita || '—')}</span>
          <span className="pill pill--neutral">Anticipo —</span>
          <span className="pill pill--neutral">Instalación —</span>
          <span className="pill pill--neutral">CFE —</span>
        </div>

        <div className="expediente-acciones-rapidas">
          <Link to={`/conversaciones/${clienteId}`} className="pregunta-tara-chip">WhatsApp</Link>
          <Link to={`/cotizaciones/nueva?clienteId=${clienteId}`} className="pregunta-tara-chip">Cotizar</Link>
          <button type="button" className="pregunta-tara-chip" onClick={() => { irATab('operacion'); setMostrarNuevaCita(true); }}>Agendar</button>
          <button type="button" className="pregunta-tara-chip" onClick={() => irATab('historial')}>Seguimiento</button>
          {oportunidadPrincipal && (
            <button type="button" className="pregunta-tara-chip" onClick={() => { irATab('resumen'); ayudameACerrar(oportunidadPrincipal.id); }}>
              Ayúdame a cerrar
            </button>
          )}
        </div>
      </section>

      <div className="config-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tabActiva ? 'config-tab config-tab--activa' : 'config-tab'} onClick={() => setTabActiva(t.id)}>
            {t.etiqueta}
          </button>
        ))}
      </div>

      {tabActiva === 'resumen' && (
        <>
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
                <dt>Fuente</dt><dd>{cliente.fuente || '—'}</dd>
                <dt>Notas</dt><dd>{cliente.notas || '—'}</dd>
                <dt>Atendido por</dt><dd>{cliente.atendido_por === 'humano' ? 'Atención personal' : 'TARA'}</dd>
              </dl>
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
        </>
      )}

      {tabActiva === 'consumo' && (
        <section className="crm-seccion">
          <h2>Consumo / CFE</h2>

          <label htmlFor="input-recibo-cfe" className="pregunta-tara-chip" style={{ cursor: 'pointer', display: 'inline-block' }}>
            {subiendoRecibo ? 'Leyendo recibo…' : 'Subir recibo CFE'}
          </label>
          <input
            id="input-recibo-cfe" type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
            disabled={subiendoRecibo} onChange={subirRecibo}
          />
          <p className="operaciones-nota">Detecta el consumo, importe y tarifa. Siempre revisa/corrige antes de guardar — la extracción nunca es infalible.</p>

          {erroRecibo && <p className="login-error">{erroRecibo}</p>}

          {borradorRecibo && (
            <div className="pregunta-tara-respuesta">
              <p><strong>Borrador extraído — corrige lo que haga falta antes de guardar:</strong></p>
              <label>Consumo mensual (kWh)
                <input type="number" value={borradorRecibo.consumoMensualKwh ?? ''}
                  onChange={(e) => setBorradorRecibo({ ...borradorRecibo, consumoMensualKwh: e.target.value ? Number(e.target.value) : null })} />
              </label>
              <label>Importe promedio ($)
                <input type="number" value={borradorRecibo.importePromedioRecibo ?? ''}
                  onChange={(e) => setBorradorRecibo({ ...borradorRecibo, importePromedioRecibo: e.target.value ? Number(e.target.value) : null })} />
              </label>
              <label>Tarifa
                <input type="text" value={borradorRecibo.tarifa ?? ''}
                  onChange={(e) => setBorradorRecibo({ ...borradorRecibo, tarifa: e.target.value || null })} />
              </label>
              <div className="modal-acciones">
                <button type="button" onClick={() => setBorradorRecibo(null)}>Descartar</button>
                <button type="button" onClick={confirmarRecibo}>Guardar en la oportunidad</button>
              </div>
            </div>
          )}

          <dl className="crm-datos-lista">
            <dt>Recibo recibido</dt><dd>{oportunidadPrincipal?.recibo_cfe_recibido ? 'Sí' : '—'}</dd>
            <dt>Consumo mensual</dt><dd>{oportunidadPrincipal?.consumo_mensual_kwh ? `${oportunidadPrincipal.consumo_mensual_kwh} kWh` : '—'}</dd>
            <dt>Importe promedio</dt><dd>{oportunidadPrincipal?.importe_promedio_recibo ? `$${oportunidadPrincipal.importe_promedio_recibo}` : '—'}</dd>
            <dt>Tarifa CFE</dt><dd>{oportunidadPrincipal?.tarifa_cfe || '—'}</dd>
          </dl>
          <p className="operaciones-nota">Historial de consumo por periodo — todavía no se muestra aquí gráficamente (auditoría, sección Fase 3).</p>
        </section>
      )}

      {tabActiva === 'proyecto' && (
        <section className="crm-seccion">
          <h2>Proyecto solar</h2>
          <dl className="crm-datos-lista">
            <dt>Tipo de inmueble</dt><dd>{oportunidadPrincipal?.tipo_propiedad || '—'}</dd>
            <dt>Dirección</dt><dd>{oportunidadPrincipal?.direccion || '—'}</dd>
            <dt>Colonia</dt><dd>{oportunidadPrincipal?.colonia || '—'}</dd>
            <dt>Alimentación eléctrica</dt><dd>{oportunidadPrincipal?.tipo_alimentacion || '—'}</dd>
            <dt>% cobertura deseado</dt><dd>{oportunidadPrincipal?.pct_cobertura_deseado ? `${oportunidadPrincipal.pct_cobertura_deseado}%` : '—'}</dd>
            <dt>Paneles sugeridos</dt><dd>{oportunidadPrincipal?.paneles_estimados || '—'}</dd>
            <dt>kWp estimado</dt><dd>{oportunidadPrincipal?.kwp_estimado || '—'}</dd>
          </dl>
          <p className="operaciones-nota">
            Datos técnicos del inmueble (tipo de techo, orientación, sombras, área disponible, centro de carga, cargas por
            equipo y cargas futuras) todavía no se capturan por este canal — pendiente, ver auditoría Fase 3.
          </p>
        </section>
      )}

      {tabActiva === 'cotizaciones' && (
        <section className="crm-seccion">
          <div className="crm-seccion-header">
            <h2>Cotizaciones</h2>
            <Link to={`/cotizaciones/nueva?clienteId=${clienteId}`}>+ Nueva cotización</Link>
          </div>
          {cotizaciones === null ? (
            <p className="operaciones-nota">Cargando…</p>
          ) : cotizaciones.length === 0 ? (
            <p className="operaciones-nota">Este cliente todavía no tiene cotizaciones.</p>
          ) : (
            <ul className="config-kb-lista">
              {cotizaciones.map((c) => (
                <li key={c.id} className="config-kb-item">
                  <strong>{c.folio || `Cotización #${c.id}`}</strong> — {c.producto || 'Sin paquete'}
                  {c.total != null ? ` — $${Number(c.total).toLocaleString('es-MX')}` : ''}
                  {' — '}<span className="pill pill--neutral">{c.estado}</span>
                  {' '}<Link to={`/cotizaciones/${c.id}`}>Ver</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tabActiva === 'conversacion' && (
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
      )}

      {tabActiva === 'documentos' && (
        <section className="crm-seccion">
          <h2>Documentos</h2>
          <p className="operaciones-nota">
            Todavía no existe un expediente documental clasificado por cliente (recibo CFE, identificación, fotos de
            techo/medidor/centro de carga, contrato, comprobantes, garantías) — hoy solo hay adjuntos crudos del chat de
            WhatsApp, visibles en la pestaña Conversación. Pendiente, ver auditoría Fase 3.
          </p>
        </section>
      )}

      {tabActiva === 'operacion' && (
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

          <p className="operaciones-nota">Instalación, trámite CFE y garantías todavía no tienen módulo propio — pendiente, ver auditoría Fases 2/4.</p>
        </section>
      )}

      {tabActiva === 'historial' && (
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
      )}
    </div>
  );
}
