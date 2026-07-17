import { useEffect, useRef, useState } from 'react';
import { usePolling } from '../../lib/usePolling';
import { api } from '../../lib/api';
import { iniciales, colorDesdeTexto } from '../../lib/avatar';
import NuevaCitaModal from './NuevaCitaModal';
import ComandoModal from './ComandoModal';

// Identidad Atelier — TARA Canvas: el lienzo (línea de tiempo) es el
// producto, ocupa la pantalla casi por completo. TARA no vive en un panel
// aparte: las recomendaciones se anclan directo sobre el bloque (anillo de
// pulso + popover al hacer clic), y ⌘K es la puerta de entrada a buscar,
// preguntar y actuar. Arquitectura UX aprobada — ver plan "TARA Canvas".

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function minutosDeHHMMSS(hhmmss) {
  const [h, m] = (hhmmss || '00:00:00').split(':').map(Number);
  return h * 60 + m;
}

function minutosLocales(iso, zona) {
  const d = new Date(iso);
  const [h, m] = d.toLocaleTimeString('en-GB', { hour12: false, timeZone: zona || 'UTC' }).split(':').map(Number);
  return h * 60 + m;
}

function posicionEnJornada(inicioIso, finIso, horario) {
  if (!horario) return { leftPct: 0, widthPct: 0 };
  const jIni = minutosDeHHMMSS(horario.hora_inicio);
  const jFin = minutosDeHHMMSS(horario.hora_fin);
  const total = Math.max(1, jFin - jIni);
  const cIni = minutosLocales(inicioIso, horario.zona_horaria);
  const cFin = minutosLocales(finIso, horario.zona_horaria);
  const left = Math.max(0, Math.min(100, ((cIni - jIni) / total) * 100));
  return { leftPct: left, widthPct: Math.max(0, Math.min(100 - left, ((cFin - cIni) / total) * 100)) };
}

function claseDelBloque(cita, ahora) {
  if (cita.estado === 'cancelada' || cita.estado === 'no_show') return 'cancel';
  if (cita.estado === 'completada') return 'done';
  const inicio = new Date(cita.inicio).getTime();
  const fin = new Date(cita.fin).getTime();
  if (ahora >= inicio && ahora <= fin) return 'now';
  return 'upcoming';
}

function formatearHora(iso, zona) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: zona || undefined });
}

function horaLocalHHMM(iso, zona) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false, timeZone: zona || 'UTC' }).slice(0, 5);
}

// % transcurrido de una cita contra su horario PROGRAMADO (no hay check-in
// real todavía — Etapa C, ver artifact de diseño §18) — honesto y
// etiquetado como tal en la UI, nunca presentado como "tiempo real exacto".
function progresoPct(cita, ahora) {
  const inicio = new Date(cita.inicio).getTime();
  const fin = new Date(cita.fin).getTime();
  if (cita.estado === 'completada') return 100;
  if (fin <= inicio) return 0;
  return Math.max(0, Math.min(100, ((ahora - inicio) / (fin - inicio)) * 100));
}

const SEGMENTO_ICONO = { leal: '💗', requiere_atencion: '🟠', oportunidad: '↗', ocasional: '◦' };
const SEGMENTO_TITULO = {
  leal: 'Leal — visita con frecuencia', requiere_atencion: 'Requiere atención — cancelaciones o retrasos frecuentes',
  oportunidad: 'Oportunidad — clienta nueva', ocasional: 'Ocasional',
};

function serviciosQueCaben(servicios, minutosHueco) {
  return (servicios || []).filter(s => s.duracion_minutos && s.duracion_minutos <= minutosHueco);
}

function rangoPotencial(servicios) {
  const precios = servicios.map(s => s.precio).filter(p => p != null);
  if (!precios.length) return null;
  return { min: Math.min(...precios), max: Math.max(...precios) };
}

// Sparkline real de ocupación por hora — nunca datos inventados: se deriva
// de las mismas citas ya cargadas, agrupadas por hora del primer recurso
// con horario (misma simplificación de "horario de referencia" que ya usa
// el resto del módulo).
function ocupacionPorHora(recursos) {
  const conHorario = (recursos || []).find(r => r.horario);
  if (!conHorario) return [];
  const jIni = minutosDeHHMMSS(conHorario.horario.hora_inicio);
  const jFin = minutosDeHHMMSS(conHorario.horario.hora_fin);
  const horas = [];
  for (let t = jIni; t < jFin; t += 60) horas.push(t);

  const todasCitas = (recursos || []).flatMap(r => r.citas || []);
  return horas.map((horaIni) => {
    const horaFin = horaIni + 60;
    let ocupadoMin = 0;
    for (const c of todasCitas) {
      if (!['agendada', 'confirmada', 'completada'].includes(c.estado)) continue;
      const cIni = minutosLocales(c.inicio, conHorario.horario.zona_horaria);
      const cFin = minutosLocales(c.fin, conHorario.horario.zona_horaria);
      const solapa = Math.min(cFin, horaFin) - Math.max(cIni, horaIni);
      if (solapa > 0) ocupadoMin += solapa;
    }
    return Math.min(1, ocupadoMin / 60);
  });
}

const ACCION_TEXTO = {
  confirmar_llegada: 'Confirmar',
  marcar_no_show: 'Marcar inasistencia',
};

export default function AgendaViva() {
  const [fecha] = useState(hoyISO());
  const { datos: estado, setDatos, error, cargando } = usePolling(() => api.estadoDelDiaAgenda(fecha), 8000);
  const [asesoresModal, setAsesoresModal] = useState([]);
  const [clientesModal, setClientesModal] = useState([]);
  const [mostrarNuevaCita, setMostrarNuevaCita] = useState(false);
  const [prellenadoNuevaCita, setPrellenadoNuevaCita] = useState(null); // { asesorId, hora }
  const [mostrarComando, setMostrarComando] = useState(false);
  const [popover, setPopover] = useState(null); // { recomendacion, top, left }
  const [arrastrando, setArrastrando] = useState(null);
  const [dockAbierto, setDockAbierto] = useState(false);
  const [errorAccion, setErrorAccion] = useState(null);
  const [resolviendo, setResolviendo] = useState(false);
  const canvasBodyRef = useRef(null);

  useEffect(() => {
    function alTeclado(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMostrarComando(true);
      }
    }
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, []);

  async function recargar() {
    try {
      const nuevo = await api.estadoDelDiaAgenda(fecha);
      setDatos(nuevo);
    } catch { /* el próximo poll lo intenta de nuevo */ }
  }

  function abrirNuevaCita(prellenado = null) {
    api.asesores().then(setAsesoresModal).catch(() => {});
    api.clientesCrm().then(setClientesModal).catch(() => {});
    setPrellenadoNuevaCita(prellenado);
    setMostrarNuevaCita(true);
  }

  function abrirPopover(e, recomendacion) {
    e.stopPropagation();
    // position: fixed → coordenadas de viewport directas (getBoundingClientRect
    // ya las da así), para que el popover no quede recortado por el
    // overflow:hidden del contenedor redondeado del lienzo.
    const rectBloque = e.currentTarget.getBoundingClientRect();
    setPopover({
      recomendacion,
      top: rectBloque.bottom + 6,
      left: Math.min(rectBloque.left, window.innerWidth - 266),
    });
  }

  async function resolverConAccion(recomendacion) {
    setResolviendo(true); setErrorAccion(null);
    try {
      if (recomendacion.accion === 'marcar_no_show') {
        await api.marcarNoShow(recomendacion.cita_id);
      }
      await api.resolverEventoAgenda(recomendacion.evento_id, {
        estado: 'aceptada',
        accion_tomada: { tipo: recomendacion.accion },
        resultado: recomendacion.accion === 'marcar_no_show' ? 'Marcada como inasistencia' : 'Confirmado por la usuaria',
      });
      setPopover(null);
      await recargar();
    } catch (e) {
      setErrorAccion(e.message);
    } finally {
      setResolviendo(false);
    }
  }

  async function descartar(recomendacion) {
    setResolviendo(true); setErrorAccion(null);
    try {
      await api.resolverEventoAgenda(recomendacion.evento_id, { estado: 'descartada', accion_tomada: { tipo: 'descartar' }, resultado: 'Descartada por la usuaria' });
      setPopover(null);
      await recargar();
    } catch (e) {
      setErrorAccion(e.message);
    } finally {
      setResolviendo(false);
    }
  }

  // ── Arrastrar y soltar real ────────────────────────────────────────────
  function iniciarArrastre(e, cita, recurso) {
    if (e.button !== 0 || !recurso.horario) return;
    e.preventDefault();
    e.stopPropagation();
    const trackRect = e.currentTarget.closest('.agenda-viva-track').getBoundingClientRect();
    const totalMin = minutosDeHHMMSS(recurso.horario.hora_fin) - minutosDeHHMMSS(recurso.horario.hora_inicio);
    setArrastrando({ cita, recurso, startX: e.clientX, trackWidth: trackRect.width, totalMin, deltaPx: 0, deltaMin: 0 });
  }

  useEffect(() => {
    if (!arrastrando) return;
    function mover(e) {
      setArrastrando((a) => {
        if (!a) return a;
        const deltaPx = e.clientX - a.startX;
        const deltaMinRaw = (deltaPx / a.trackWidth) * a.totalMin;
        return { ...a, deltaPx, deltaMin: Math.round(deltaMinRaw / 15) * 15 };
      });
    }
    async function soltar() {
      setArrastrando((a) => {
        if (a && a.deltaMin !== 0) confirmarNuevoHorario(a);
        return null;
      });
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrastrando?.cita?.id]);

  async function confirmarNuevoHorario(a) {
    const nuevoInicio = new Date(new Date(a.cita.inicio).getTime() + a.deltaMin * 60000);
    const nuevoFin = new Date(new Date(a.cita.fin).getTime() + a.deltaMin * 60000);
    try {
      await api.reagendarCita(a.cita.id, nuevoInicio.toISOString(), nuevoFin.toISOString());
      await recargar();
    } catch (e) {
      setErrorAccion(e.message);
    }
  }

  if (cargando && !estado) return <p className="operaciones-nota">TARA está revisando la agenda…</p>;
  if (error) return <p className="login-error">No se pudo cargar la agenda: {error}</p>;
  if (!estado) return null;

  const ahora = Date.now();
  const term = estado.config.terminologia;
  const recomendacionPorCita = new Map(estado.recomendaciones.filter(r => r.cita_id).map(r => [r.cita_id, r]));
  const alertasActivas = estado.recomendaciones.length;
  const sparkline = ocupacionPorHora(estado.recursos);

  return (
    <div>
      <div className="agenda-viva-header">
        <h1>Agenda</h1>
        <button onClick={() => abrirNuevaCita()}>Nueva {term.bloque.singular.toLowerCase()}</button>
      </div>

      <div className="agenda-viva-console">
        <div className="agenda-viva-cmdbar">
          <span className="agenda-viva-narrativa">
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} ·
            {' '}{estado.recursos.length} {term.recurso.plural.toLowerCase()} ·
            {' '}{alertasActivas === 0 ? 'todo en orden' : `${alertasActivas} cosa(s) necesitan tu atención`}
          </span>
          {sparkline.length > 0 && (
            <span className="agenda-viva-spark">
              {sparkline.map((v, i) => (
                <i key={i} className={v > 0.5 ? 'hi' : ''} style={{ height: `${4 + v * 12}px` }} />
              ))}
            </span>
          )}
          <span className="agenda-viva-ai-pill"><span className="ai-dot" />TARA ya revisó tu día</span>
          <button className="agenda-viva-cmdk-pill" onClick={() => setMostrarComando(true)}>
            Buscar o preguntarle a TARA… <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="agenda-viva-body" ref={canvasBodyRef} onClick={() => setPopover(null)}>
          {estado.recursos.length === 0 && (
            <p className="operaciones-nota">Sin {term.recurso.plural.toLowerCase()} activas configuradas.</p>
          )}

          {estado.recursos.map((r) => (
            <div className="agenda-viva-lane" key={r.asesorId}>
              <div className="agenda-viva-lane-who">
                <span className="agenda-viva-avatar" style={{ background: colorDesdeTexto(r.asesorNombre) }}>{iniciales(r.asesorNombre)}</span>
                <span className="agenda-viva-nombre">{r.asesorNombre}</span>
                <span className="agenda-viva-lane-stat">{r.ocupacionPct}% ocupada</span>
                <span className="agenda-viva-lane-stat">{r.citas.length} {term.bloque.plural.toLowerCase()}</span>
                {r.siguienteEspacio && (
                  <span className="agenda-viva-lane-stat agenda-viva-lane-stat--next">
                    Siguiente espacio: {formatearHora(r.siguienteEspacio.inicio, r.horario?.zona_horaria)}
                  </span>
                )}
              </div>
              <div className="agenda-viva-track">
                {r.citas.map((c) => {
                  const arrastrandoEsta = arrastrando?.cita?.id === c.id;
                  const { leftPct, widthPct } = posicionEnJornada(c.inicio, c.fin, r.horario);
                  const clase = claseDelBloque(c, ahora);
                  const rec = recomendacionPorCita.get(c.id);
                  const segmentos = c.clientes?.segmentos || [];
                  const estilo = { left: `${leftPct}%`, width: `${Math.max(widthPct, 3)}%` };
                  if (arrastrandoEsta) estilo.transform = `translateX(${arrastrando.deltaPx}px)`;
                  return (
                    <div
                      key={c.id}
                      className={`agenda-viva-blk agenda-viva-blk--${clase}${rec ? ' agenda-viva-blk--alerta' : ''}${arrastrandoEsta ? ' agenda-viva-blk--arrastrando' : ''}`}
                      style={estilo}
                      onPointerDown={(e) => iniciarArrastre(e, c, r)}
                      onClick={(e) => rec && abrirPopover(e, rec)}
                      title={`${formatearHora(c.inicio, r.horario?.zona_horaria)}–${formatearHora(c.fin, r.horario?.zona_horaria)} · ${c.clientes?.nombre || c.clientes?.telefono || 'Sin nombre'}`}
                    >
                      {segmentos[0] && (
                        <span className="agenda-viva-badge-segmento" title={SEGMENTO_TITULO[segmentos[0]]}>{SEGMENTO_ICONO[segmentos[0]]}</span>
                      )}
                      <b>{c.clientes?.nombre || c.clientes?.telefono || term.contacto.singular}</b>
                      <span>{formatearHora(c.inicio, r.horario?.zona_horaria)}</span>
                      {clase !== 'cancel' && (
                        <span className="agenda-viva-progress"><span className="agenda-viva-progress-fill" style={{ width: `${progresoPct(c, ahora)}%` }} /></span>
                      )}
                    </div>
                  );
                })}
                {(r.huecos || []).map((h, i) => {
                  const { leftPct, widthPct } = posicionEnJornada(h.inicio, h.fin, r.horario);
                  const caben = serviciosQueCaben(estado.servicios, h.minutos);
                  const potencial = rangoPotencial(caben);
                  return (
                    <div key={`h-${i}`} className="agenda-viva-blk agenda-viva-blk--gap" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                      <span className="agenda-viva-slot-min">{h.minutos} min libres</span>
                      <div className="agenda-viva-slot-hover">
                        {caben.length > 0 && <span className="agenda-viva-slot-caben">Caben: {caben.map(s => s.nombre).join(', ')}</span>}
                        {potencial && (
                          <span className="agenda-viva-slot-potencial">
                            Potencial: ${potencial.min.toLocaleString('es-MX')}{potencial.max !== potencial.min ? `–$${potencial.max.toLocaleString('es-MX')}` : ''}
                          </span>
                        )}
                        <button
                          className="agenda-viva-slot-btn"
                          onClick={(e) => { e.stopPropagation(); abrirNuevaCita({ asesorId: r.asesorId, hora: horaLocalHHMM(h.inicio, r.horario?.zona_horaria) }); }}
                        >
                          Agregar cita
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {popover && (
            <div className="agenda-viva-popover" style={{ top: popover.top, left: popover.left }} onClick={(e) => e.stopPropagation()}>
              <p>{popover.recomendacion.texto}</p>
              {popover.recomendacion.detalle && <p className="agenda-viva-popover-detalle">{popover.recomendacion.detalle}</p>}
              {errorAccion && <p className="agenda-viva-popover-error">{errorAccion}</p>}
              <div className="agenda-viva-popover-acciones">
                {ACCION_TEXTO[popover.recomendacion.accion] && (
                  <button disabled={resolviendo} onClick={() => resolverConAccion(popover.recomendacion)}>
                    {ACCION_TEXTO[popover.recomendacion.accion]}
                  </button>
                )}
                <button className="agenda-viva-ghost" disabled={resolviendo} onClick={() => descartar(popover.recomendacion)}>Descartar</button>
              </div>
            </div>
          )}

          <div className="agenda-viva-legend">
            <span><i className="agenda-viva-blk--upcoming" />Próxima</span>
            <span><i className="agenda-viva-blk--now" />En curso</span>
            <span><i className="agenda-viva-blk--done" />Completada</span>
            <span><i className="agenda-viva-blk--alerta" />Necesita atención</span>
            <span><i className="agenda-viva-blk--gap" />Espacio libre</span>
          </div>
        </div>

        <div className="agenda-viva-metrics-dock">
          <button className="agenda-viva-dock-handle" onClick={() => setDockAbierto(!dockAbierto)}>
            {dockAbierto ? '▾' : '▴'} Métricas — {estado.metricas.ocupacionPct}% ocupación · {estado.metricas.citasRestantes} {term.bloque.plural.toLowerCase()} restantes
          </button>
          {dockAbierto && (
            <div className="agenda-viva-kpirail">
              <div className="agenda-viva-kpi"><div className="v">{estado.metricas.ocupacionPct}%</div><div className="l">Ocupación de hoy</div></div>
              <div className="agenda-viva-kpi"><div className="v">{estado.metricas.citasRestantes}</div><div className="l">{term.bloque.plural} restantes</div></div>
              <div className="agenda-viva-kpi"><div className="v">{estado.metricas.puntualidadAproxPct}%</div><div className="l">Puntualidad (aprox.)</div></div>
              <div className="agenda-viva-kpi"><div className="v agenda-viva-nodisp">No disponible</div><div className="l">Ganancias del día — Fase 2</div></div>
              <div className="agenda-viva-kpi"><div className="v agenda-viva-nodisp">No disponible</div><div className="l">Tiempo promedio — Fase 2</div></div>
            </div>
          )}
        </div>
      </div>

      {mostrarNuevaCita && (
        <NuevaCitaModal
          asesores={asesoresModal}
          clientesExistentes={clientesModal}
          fechaDefault={fecha}
          asesorIdDefault={prellenadoNuevaCita?.asesorId}
          horaDefault={prellenadoNuevaCita?.hora}
          onCerrar={() => setMostrarNuevaCita(false)}
          onCreada={() => { setMostrarNuevaCita(false); recargar(); }}
        />
      )}

      {mostrarComando && (
        <ComandoModal estado={estado} onCerrar={() => setMostrarComando(false)} onEjecutado={recargar} />
      )}
    </div>
  );
}
