import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

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

function responderPregunta(pregunta, metricas) {
  const seguimiento = metricas.recomendaciones.filter(r => r.accion === 'Dar seguimiento ahora');
  const entregas = metricas.recomendaciones.filter(r => r.accion === 'Ver pedido');
  const cotizaciones = metricas.kpis.find(k => k.etiqueta === 'Cotizaciones enviadas');

  switch (pregunta) {
    case '¿Qué clientes necesitan seguimiento?':
    case '¿Qué clientes llevan más de 48 horas sin responder?':
      return seguimiento.length === 0
        ? 'Ningún cliente lleva más de 48 horas sin seguimiento en este momento.'
        : `${seguimiento.map(r => r.texto).join(' ')}`;
    case '¿Cuántas cotizaciones llevo esta semana?':
      return cotizaciones
        ? `Llevas ${cotizaciones.valor} cotizaciones enviadas activas en este momento.`
        : 'No encontré cotizaciones enviadas en este momento.';
    case '¿Qué pedidos debo entregar hoy?':
      return entregas.length === 0
        ? 'No tienes pedidos marcados como listos para entrega en este momento.'
        : `${entregas.map(r => r.texto).join(' ')}`;
    default:
      return null;
  }
}

function saludoPorHora() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// TARA siempre habla en primera persona ("Encontré/Revisé"), nunca como
// "el sistema" — mismo criterio ya definido para el resto del producto.
function resumenTara(metricas, empresa, esUniformesDeportivos) {
  if (esUniformesDeportivos) {
    const recos = metricas.recomendaciones || [];
    if (recos.length === 0) return `Ya revisé ${empresa} y no encontré pendientes urgentes — todo está al día.`;
    if (recos.length === 1) return `Ya revisé ${empresa}. Encontré algo que necesita tu atención: ${recos[0].texto}`;
    return `Ya revisé ${empresa}. Encontré ${recos.length} cosas que necesitan tu atención: ${recos.map(r => r.texto).join(' ')}`;
  }
  const alertas = metricas.alertas || [];
  if (alertas.length === 0) return `Ya revisé ${empresa} y no encontré pendientes urgentes — todo está en orden.`;
  return `Ya revisé ${empresa}. Encontré ${alertas.length} alerta${alertas.length > 1 ? 's' : ''} que requiere${alertas.length > 1 ? 'n' : ''} tu atención.`;
}

// Fase 2: Centro de Operaciones real. Sin lógica de negocio aquí — solo
// pide /api/dashboard y pinta lo que regresa el backend (modules/dashboard.js).
//
// Orden de la pantalla (pedido explícito del producto): primero TARA habla
// — saludo + qué encontró y qué recomienda —, después las acciones
// sugeridas, y solo al final las métricas como respaldo. El valor no son
// los KPIs; es que TARA entiende el negocio y dice qué hacer.
export default function Operaciones() {
  const { sesion } = useAuth();
  const [metricas, setMetricas] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [preguntaActiva, setPreguntaActiva] = useState(null);

  const esUniformesDeportivos = sesion?.empresaActiva?.industria_slug === 'uniformes_deportivos';
  const empresa = sesion?.empresaActiva?.nombre || 'tu empresa';
  const nombreUsuario = (sesion?.usuario?.nombre || sesion?.usuario?.email || '').split(' ')[0];

  useEffect(() => {
    let activo = true;
    api.dashboard()
      .then((datos) => { if (activo) setMetricas(datos); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  return (
    <div>
      {cargando && <p className="operaciones-nota">TARA está revisando {empresa}…</p>}
      {error && <p className="login-error">No se pudieron cargar las métricas: {error}</p>}

      {metricas && (
        <>
          <div className="tara-hero">
            <p className="tara-hero-saludo">{saludoPorHora()}{nombreUsuario ? `, ${nombreUsuario}` : ''}.</p>
            <p className="tara-hero-resumen">{resumenTara(metricas, empresa, esUniformesDeportivos)}</p>
          </div>

          {esUniformesDeportivos && (
            <>
              {metricas.recomendaciones && metricas.recomendaciones.length > 0 && (
                <ul className="recomendaciones-lista">
                  {metricas.recomendaciones.map((r, i) => (
                    <li key={i} className="recomendacion-tarjeta">
                      <div>
                        <strong>{r.texto}</strong>
                        <p className="operaciones-nota">{r.detalle}</p>
                      </div>
                      <Link to={r.recurso} className="recomendacion-accion">{r.accion}</Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pregunta-tara-caja">
                <p className="pregunta-tara-etiqueta">Pregúntale a TARA</p>
                <div className="pregunta-tara-sugerencias">
                  {PREGUNTAS_UNIFORMES_DEPORTIVOS.map((p) => (
                    <button key={p} className="pregunta-tara-chip" onClick={() => setPreguntaActiva(p)}>
                      {p}
                    </button>
                  ))}
                </div>
                {preguntaActiva && (
                  <p className="pregunta-tara-respuesta">
                    {responderPregunta(preguntaActiva, metricas)}
                  </p>
                )}
              </div>
            </>
          )}

          <h2 className="alertas-titulo alertas-titulo--secundario">Métricas</h2>
          <div className="metricas-grid">
            {(metricas.kpis || []).map((k, i) => (
              <TarjetaMetrica key={i} etiqueta={k.etiqueta} valor={k.valor} />
            ))}
          </div>

          {!esUniformesDeportivos && (
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

function TarjetaMetrica({ etiqueta, valor }) {
  return (
    <div className="metrica-tarjeta">
      <span className="metrica-valor">{valor ?? '—'}</span>
      <span className="metrica-etiqueta">{etiqueta}</span>
    </div>
  );
}
