import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import LogoTara from '../components/LogoTara';
import SuscripcionBanner from '../components/SuscripcionBanner';

function saludoPorHora() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// El ícono "A" del isotipo — reutilizado como botón de envío de Pregúntale
// a TARA (Brand Guidelines V1.0: "eso hace marca", en vez de una flecha
// genérica). Sin fondo propio: el botón circular verde ya lo da.
function IconoA() {
  return <LogoTara size={15} background={null} foreground="#fff" dot="#22c7b8" />;
}

// Filosofía del hero (pedido explícito): "Buenos días, Luis. Encontré 4
// prioridades para hoy. Nada más." — un conteo, no un párrafo. El detalle
// de cada prioridad vive únicamente en las tarjetas de recomendación.
function contarPrioridades(metricas, tieneRecomendacionesRicas) {
  return tieneRecomendacionesRicas
    ? (metricas.recomendaciones || []).length
    : (metricas.alertas || []).length;
}

// Lista de recomendaciones de TARA — misma tarjeta para uniformes_deportivos
// (junto a "Estado de ventas") y salon_belleza (a todo el ancho), sin
// duplicar el JSX entre ambas industrias.
function ListaRecomendaciones({ recomendaciones }) {
  return (
    <>
      <h2 className="alertas-titulo alertas-titulo--secundario">Recomendaciones de TARA</h2>
      {recomendaciones && recomendaciones.length > 0 ? (
        <ul className="recomendaciones-lista">
          {recomendaciones.map((r, i) => (
            <li key={i} className={`recomendacion-tarjeta recomendacion-tarjeta--${r.severidad || 'info'}`}>
              <span className="recomendacion-punto"></span>
              <div className="recomendacion-cuerpo">
                <p className="recomendacion-texto">{r.texto}</p>
                <p className="recomendacion-detalle">{r.detalle}</p>
              </div>
              <Link to={r.recurso} className="recomendacion-accion">{r.accion}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="operaciones-nota">Sin recomendaciones — todo al día.</p>
      )}
    </>
  );
}

// Fase 2: Centro de Operaciones real. Sin lógica de negocio aquí — solo
// pide /api/dashboard y pinta lo que regresa el backend (modules/dashboard.js).
//
// Orden de la pantalla (pedido explícito del producto): primero TARA habla
// — saludo + cuántas prioridades encontró —, después las recomendaciones y
// Pregúntale a TARA, y solo al final las métricas como respaldo. El valor
// no son los KPIs; es que TARA entiende el negocio y dice qué hacer.
export default function Operaciones() {
  const { sesion } = useAuth();
  const { datos: metricas, error, cargando } = usePolling(() => api.dashboard(), 4000);
  const [preguntaInput, setPreguntaInput] = useState('');
  const [preguntaActiva, setPreguntaActiva] = useState(null);
  const [respuestaOperador, setRespuestaOperador] = useState(null);
  const [cargandoRespuesta, setCargandoRespuesta] = useState(false);
  // Centro de Conocimiento, Fase 3 — "Convertir en respuesta para cliente".
  const [respuestaCliente, setRespuestaCliente] = useState(null);
  const [cargandoConversion, setCargandoConversion] = useState(false);

  // Modo Operador (modules/operador-engine.js) — IA real con acceso de solo
  // lectura a tareas/proyectos/decisiones/CRM de esta empresa, no el match
  // por palabras clave de antes. Disponible para cualquier empresa, no solo
  // las 2 industrias demo.
  async function preguntarleATara(texto) {
    setPreguntaActiva(texto);
    setCargandoRespuesta(true);
    setRespuestaOperador(null);
    setRespuestaCliente(null);
    try {
      const resultado = await api.preguntarOperador(texto);
      setRespuestaOperador(resultado.respuesta_texto);
    } catch (e) {
      setRespuestaOperador(e.status === 403
        ? 'No tienes acceso a Modo Operador con tu rol actual.'
        : 'No pude responder en este momento — intenta de nuevo.');
    } finally {
      setCargandoRespuesta(false);
    }
  }

  function enviarPregunta(e) {
    e.preventDefault();
    if (!preguntaInput.trim()) return;
    preguntarleATara(preguntaInput.trim());
  }

  function elegirSugerencia(p) {
    setPreguntaInput(p);
    preguntarleATara(p);
  }

  // Centro de Conocimiento, Fase 3 — traduce la respuesta interna de TARA a
  // un mensaje listo para copiar y enviarle a un cliente.
  async function convertirEnRespuestaParaCliente() {
    if (!respuestaOperador) return;
    setCargandoConversion(true);
    setRespuestaCliente(null);
    try {
      const resultado = await api.convertirParaCliente(respuestaOperador);
      setRespuestaCliente(resultado.respuesta_cliente);
    } catch {
      setRespuestaCliente('No pude generar la versión para cliente — intenta de nuevo.');
    } finally {
      setCargandoConversion(false);
    }
  }

  // Motor Universal: el layout "recomendaciones ricas" (vs. alertas/actividad
  // genérico) y sus preguntas sugeridas vienen de la plantilla de industria
  // (plantillas_industria.ui_config.dashboard) — sin esa config, la empresa
  // ve el dashboard genérico universal (metricas.alertas/actividadReciente).
  const dashboardConfig = sesion?.empresaActiva?.ui_config?.dashboard;
  const tieneRecomendacionesRicas = !!dashboardConfig;
  const layoutVentas = dashboardConfig?.layout === 'ventas';
  // Nort Energy Operations (Alina 2026-09-09): mismo mecanismo opt-in que
  // layoutVentas — dos niveles visuales, ejecutivo (KPIs) arriba y operativo
  // (recomendaciones + estado de ventas) abajo, sin tocar ningún otro layout.
  const layoutDosNiveles = dashboardConfig?.layout === 'operaciones_dos_niveles';
  const preguntasSugeridas = dashboardConfig?.preguntasSugeridas || [];
  const empresa = sesion?.empresaActiva?.nombre || 'tu empresa';
  // Si el usuario no tiene nombre configurado (solo email), se omite del
  // saludo en vez de mostrar el email como si fuera un nombre.
  const nombreUsuario = (sesion?.usuario?.nombre || '').trim().split(' ')[0];

  return (
    <div>
      <SuscripcionBanner />

      {cargando && <p className="operaciones-nota">TARA está revisando {empresa}…</p>}
      {error && <p className="login-error">No se pudieron cargar las métricas: {error}</p>}

      {metricas && (
        <>
          <section className="tara-hero">
            <p className="tara-hero-tagline">Powered by TARA AI</p>
            <h1 className="tara-hero-saludo">{saludoPorHora()}{nombreUsuario ? `, ${nombreUsuario}` : ''}.</h1>
            <p className="tara-hero-encontre">
              <span className="tara-hero-pulso"></span>
              {contarPrioridades(metricas, tieneRecomendacionesRicas) === 0
                ? `No encontré pendientes urgentes en ${empresa}.`
                : `Encontré ${contarPrioridades(metricas, tieneRecomendacionesRicas)} prioridades para hoy en ${empresa}.`}
            </p>
          </section>

          <div className="pregunta-tara-caja">
            <form className="pregunta-tara-input" onSubmit={enviarPregunta}>
              <input
                type="text" value={preguntaInput} placeholder="¿Qué quieres saber de tu empresa?"
                onChange={(e) => setPreguntaInput(e.target.value)}
              />
              <button type="submit" className="pregunta-tara-enviar" disabled={cargandoRespuesta}><IconoA /></button>
            </form>
            {tieneRecomendacionesRicas && (
              <div className="pregunta-tara-sugerencias">
                {preguntasSugeridas.map((p) => (
                  <button key={p} className="pregunta-tara-chip" onClick={() => elegirSugerencia(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            {preguntaActiva && (
              <>
                <p className="pregunta-tara-respuesta">
                  {cargandoRespuesta ? 'TARA está pensando…' : respuestaOperador}
                </p>
                {!cargandoRespuesta && respuestaOperador && (
                  <button
                    type="button" className="pregunta-tara-chip" onClick={convertirEnRespuestaParaCliente}
                    disabled={cargandoConversion}
                  >
                    {cargandoConversion ? 'Traduciendo…' : 'Convertir en respuesta para cliente'}
                  </button>
                )}
                {respuestaCliente && (
                  <p className="pregunta-tara-respuesta pregunta-tara-respuesta--cliente">{respuestaCliente}</p>
                )}
              </>
            )}
          </div>

          <h2 className="alertas-titulo alertas-titulo--secundario">{layoutDosNiveles ? 'Resumen ejecutivo' : 'Métricas'}</h2>
          <div className={layoutDosNiveles ? 'kpi-strip kpi-strip--ejecutivo' : 'kpi-strip'}>
            {(metricas.kpis || []).map((k, i) => (
              <div className="kpi" key={i}>
                <div className="kpi-valor">{k.valor ?? '—'}</div>
                <div className="kpi-etiqueta">{k.etiqueta}</div>
              </div>
            ))}
          </div>

          {tieneRecomendacionesRicas && layoutDosNiveles && (
            <>
              <h2 className="alertas-titulo alertas-titulo--secundario">Acciones rápidas</h2>
              <div className="acciones-rapidas">
                <Link to="/crm" className="accion-rapida-boton">+ Nuevo cliente</Link>
                <Link to="/crm/pipeline" className="accion-rapida-boton">+ Nueva oportunidad</Link>
                <Link to="/cotizaciones/nueva" className="accion-rapida-boton">+ Crear cotización</Link>
                <Link to="/agenda" className="accion-rapida-boton">+ Agendar cita</Link>
              </div>

              <section className="dashboard-nivel-operativo">
                <h2 className="alertas-titulo alertas-titulo--secundario">Centro operativo</h2>
                <ListaRecomendaciones recomendaciones={metricas.recomendaciones} />
                {metricas.panelVentas && metricas.panelVentas.length > 0 && (
                  <>
                    <h3 className="alertas-titulo alertas-titulo--secundario">Estado de ventas</h3>
                    <ul className="panel-ventas-lista">
                      {metricas.panelVentas.map((v, i) => (
                        <li key={i} className="panel-ventas-fila">
                          <div>
                            <p className="panel-ventas-cliente">{v.cliente}</p>
                            <p className="panel-ventas-estado">{v.estado}</p>
                          </div>
                          {v.monto != null && <span className="panel-ventas-monto">${Number(v.monto).toLocaleString('es-MX')}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h3 className="alertas-titulo alertas-titulo--secundario">Actividad reciente</h3>
                {!metricas.actividadReciente || metricas.actividadReciente.length === 0 ? (
                  <p className="operaciones-nota">Sin actividad reciente.</p>
                ) : (
                  <ul className="actividad-reciente-lista">
                    {metricas.actividadReciente.map((ev, i) => (
                      <li key={i} className={`actividad-item actividad-item--${ev.tipo}`}>
                        <Link to={ev.recurso}>{ev.mensaje}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {tieneRecomendacionesRicas && layoutVentas && (
            <div className="dos-columnas">
              <div>
                <ListaRecomendaciones recomendaciones={metricas.recomendaciones} />
              </div>

              <div>
                <h2 className="alertas-titulo alertas-titulo--secundario">Estado de ventas</h2>
                {metricas.panelVentas && metricas.panelVentas.length > 0 ? (
                  <ul className="panel-ventas-lista">
                    {metricas.panelVentas.map((v, i) => (
                      <li key={i} className="panel-ventas-fila">
                        <div>
                          <p className="panel-ventas-cliente">{v.cliente}</p>
                          <p className="panel-ventas-estado">{v.estado}</p>
                        </div>
                        {v.monto != null && <span className="panel-ventas-monto">${Number(v.monto).toLocaleString('es-MX')}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="operaciones-nota">Sin actividad todavía.</p>
                )}
              </div>
            </div>
          )}

          {tieneRecomendacionesRicas && !layoutVentas && !layoutDosNiveles && (
            <ListaRecomendaciones recomendaciones={metricas.recomendaciones} />
          )}

          {!tieneRecomendacionesRicas && (
            <>
              <h2 className="alertas-titulo alertas-titulo--secundario">Alertas importantes</h2>
              {metricas.alertas.length === 0 ? (
                <p className="operaciones-nota">Sin alertas — todo en orden.</p>
              ) : (
                <ul className="alertas-lista">
                  {metricas.alertas.map((a, i) => (
                    <li key={i} className={`alerta alerta--${a.tipo}`}>{a.mensaje}</li>
                  ))}
                </ul>
              )}

              <h2 className="alertas-titulo alertas-titulo--secundario">Actividad reciente</h2>
              {!metricas.actividadReciente || metricas.actividadReciente.length === 0 ? (
                <p className="operaciones-nota">Sin actividad reciente.</p>
              ) : (
                <ul className="actividad-reciente-lista">
                  {metricas.actividadReciente.map((ev, i) => (
                    <li key={i} className={`actividad-item actividad-item--${ev.tipo}`}>
                      <Link to={ev.recurso}>{ev.mensaje}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
