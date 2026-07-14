import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import LogoTara from '../components/LogoTara';

// Preguntas sugeridas para uniformes_deportivos (Fase Demo · Tienda Soccer).
// Respuesta calculada en el cliente a partir de metricas ya cargadas — sin
// backend de IA en vivo (ver decisión de alcance: freeze de funcionalidad
// nueva, esto reutiliza datos que /api/dashboard ya entrega).
const PREGUNTAS_UNIFORMES_DEPORTIVOS = [
  '¿Qué clientes necesitan seguimiento?',
  '¿Cuántas cotizaciones llevo esta semana?',
  '¿Qué pedidos debo entregar hoy?',
  '¿Qué clientes llevan más de 48 horas sin responder?',
];

// Preguntas sugeridas para salon_belleza (Fase Premium) — mismo patrón,
// mismos datos reales de modules/dashboard.js::obtenerMetricasSalonBelleza.
const PREGUNTAS_SALON_BELLEZA = [
  '¿Qué citas debo confirmar?',
  '¿Cuántas citas tengo hoy?',
  '¿Cuántas clientas nuevas llevo esta semana?',
  '¿Qué clientas no visitan hace tiempo?',
];

// Match por palabras clave (no un backend de IA en vivo) — permite escribir
// libremente en vez de solo elegir de las 4 sugeridas, reusando los mismos
// datos reales del dashboard. Si no reconoce el tema, lo dice honestamente
// en vez de inventar una respuesta.
function responderPregunta(texto, metricas) {
  const t = (texto || '').toLowerCase();
  const seguimiento = metricas.recomendaciones.filter(r => r.accion === 'Dar seguimiento ahora');
  const entregas = metricas.recomendaciones.filter(r => r.accion === 'Ver pedido');
  const cotizaciones = metricas.kpis.find(k => k.etiqueta === 'Cotizaciones enviadas');

  if (t.includes('seguimiento') || t.includes('48') || t.includes('respond')) {
    return seguimiento.length === 0
      ? 'Ningún cliente lleva más de 48 horas sin seguimiento en este momento.'
      : seguimiento.map(r => r.texto).join(' ');
  }
  if (t.includes('cotiza')) {
    return cotizaciones
      ? `Llevas ${cotizaciones.valor} cotizaciones enviadas activas en este momento.`
      : 'No encontré cotizaciones enviadas en este momento.';
  }
  if (t.includes('entreg') || t.includes('pedido')) {
    return entregas.length === 0
      ? 'No tienes pedidos marcados como listos para entrega en este momento.'
      : entregas.map(r => r.texto).join(' ');
  }
  return 'Por ahora solo puedo responder sobre seguimiento de clientes, cotizaciones y entregas — prueba con una de las preguntas sugeridas abajo.';
}

// Misma lógica de match por palabras clave, sobre los datos reales de
// obtenerMetricasSalonBelleza (KPIs y recomendaciones de citas).
function responderPreguntaSalonBelleza(texto, metricas) {
  const t = (texto || '').toLowerCase();
  const confirmar = metricas.recomendaciones.filter(r => r.accion === 'Confirmar cita');
  const retoque = metricas.recomendaciones.filter(r => r.accion === 'Enviar recordatorio');
  const citasHoy = metricas.kpis.find(k => k.etiqueta === 'Citas de hoy');
  const nuevasSemana = metricas.kpis.find(k => k.etiqueta === 'Clientas nuevas (semana)');

  if (t.includes('confirm')) {
    return confirmar.length === 0
      ? 'No hay citas pendientes de confirmar en las próximas 48 horas.'
      : confirmar.map(r => r.texto).join(' ');
  }
  if (t.includes('retoque') || t.includes('visita') || t.includes('tiempo')) {
    return retoque.length === 0
      ? 'Ninguna clienta lleva más de 45 días sin visitarnos en este momento.'
      : retoque.map(r => r.texto).join(' ');
  }
  if (t.includes('hoy')) {
    return citasHoy
      ? `Tienes ${citasHoy.valor} citas agendadas para hoy.`
      : 'No encontré citas para hoy.';
  }
  if (t.includes('nueva') || t.includes('semana')) {
    return nuevasSemana
      ? `Llevas ${nuevasSemana.valor} clientas nuevas esta semana.`
      : 'No encontré clientas nuevas esta semana.';
  }
  return 'Por ahora solo puedo responder sobre citas de hoy, confirmaciones pendientes y clientas nuevas — prueba con una de las preguntas sugeridas abajo.';
}

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

  function enviarPregunta(e) {
    e.preventDefault();
    if (!preguntaInput.trim()) return;
    setPreguntaActiva(preguntaInput.trim());
  }

  function elegirSugerencia(p) {
    setPreguntaInput(p);
    setPreguntaActiva(p);
  }

  const esUniformesDeportivos = sesion?.empresaActiva?.industria_slug === 'uniformes_deportivos';
  const esSalonBelleza = sesion?.empresaActiva?.industria_slug === 'salon_belleza';
  const tieneRecomendacionesRicas = esUniformesDeportivos || esSalonBelleza;
  const preguntasSugeridas = esSalonBelleza ? PREGUNTAS_SALON_BELLEZA : PREGUNTAS_UNIFORMES_DEPORTIVOS;
  const responder = esSalonBelleza ? responderPreguntaSalonBelleza : responderPregunta;
  const empresa = sesion?.empresaActiva?.nombre || 'tu empresa';
  // Si el usuario no tiene nombre configurado (solo email), se omite del
  // saludo en vez de mostrar el email como si fuera un nombre.
  const nombreUsuario = (sesion?.usuario?.nombre || '').trim().split(' ')[0];

  return (
    <div>
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

          {tieneRecomendacionesRicas && (
            <div className="pregunta-tara-caja">
              <form className="pregunta-tara-input" onSubmit={enviarPregunta}>
                <input
                  type="text" value={preguntaInput} placeholder="¿Qué quieres saber?"
                  onChange={(e) => setPreguntaInput(e.target.value)}
                />
                <button type="submit" className="pregunta-tara-enviar"><IconoA /></button>
              </form>
              <div className="pregunta-tara-sugerencias">
                {preguntasSugeridas.map((p) => (
                  <button key={p} className="pregunta-tara-chip" onClick={() => elegirSugerencia(p)}>
                    {p}
                  </button>
                ))}
              </div>
              {preguntaActiva && (
                <p className="pregunta-tara-respuesta">
                  {responder(preguntaActiva, metricas)}
                </p>
              )}
            </div>
          )}

          <h2 className="alertas-titulo alertas-titulo--secundario">Métricas</h2>
          <div className="kpi-strip">
            {(metricas.kpis || []).map((k, i) => (
              <div className="kpi" key={i}>
                <div className="kpi-valor">{k.valor ?? '—'}</div>
                <div className="kpi-etiqueta">{k.etiqueta}</div>
              </div>
            ))}
          </div>

          {esUniformesDeportivos && (
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

          {esSalonBelleza && (
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
