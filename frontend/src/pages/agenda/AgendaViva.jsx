import { useState } from 'react';
import { usePolling } from '../../lib/usePolling';
import { api } from '../../lib/api';
import { iniciales, colorDesdeTexto } from '../../lib/avatar';
import NuevaCitaModal from './NuevaCitaModal';

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

// Posición/ancho en % de un intervalo [inicioIso, finIso] dentro de la
// jornada de un horario — base de los bloques de la línea de tiempo.
function posicionEnJornada(inicioIso, finIso, horario) {
  if (!horario) return { leftPct: 0, widthPct: 0 };
  const jIni = minutosDeHHMMSS(horario.hora_inicio);
  const jFin = minutosDeHHMMSS(horario.hora_fin);
  const total = Math.max(1, jFin - jIni);
  const cIni = minutosLocales(inicioIso, horario.zona_horaria);
  const cFin = minutosLocales(finIso, horario.zona_horaria);
  return {
    leftPct: Math.max(0, Math.min(100, ((cIni - jIni) / total) * 100)),
    widthPct: Math.max(0, Math.min(100 - Math.max(0, ((cIni - jIni) / total) * 100), ((cFin - cIni) / total) * 100)),
  };
}

function claseDelBloque(cita, ahora, retrasoIds, noShowIds) {
  if (cita.estado === 'cancelada' || cita.estado === 'no_show') return 'cancel';
  if (cita.estado === 'completada') return 'done';
  if (retrasoIds.has(cita.id) || noShowIds.has(cita.id)) return 'late';
  const inicio = new Date(cita.inicio).getTime();
  const fin = new Date(cita.fin).getTime();
  if (ahora >= inicio && ahora <= fin) return 'now';
  return 'upcoming';
}

function formatearHora(iso, zona) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: zona || undefined });
}

const ACCION_BOTON = {
  confirmar_llegada: 'Confirmar',
  marcar_no_show: 'Marcar inasistencia',
};

export default function AgendaViva() {
  const [fecha] = useState(hoyISO());
  const { datos: estado, error, cargando } = usePolling(() => api.estadoDelDiaAgenda(fecha), 6000);
  const [asesoresModal, setAsesoresModal] = useState([]);
  const [clientesModal, setClientesModal] = useState([]);
  const [mostrarNuevaCita, setMostrarNuevaCita] = useState(false);
  const [resolviendo, setResolviendo] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);

  function abrirNuevaCita() {
    api.asesores().then(setAsesoresModal).catch(() => {});
    api.clientesCrm().then(setClientesModal).catch(() => {});
    setMostrarNuevaCita(true);
  }

  async function resolverEvento(recomendacion, { marcarNoShowPrimero } = {}) {
    setResolviendo(recomendacion.evento_id);
    setErrorAccion(null);
    try {
      if (marcarNoShowPrimero) {
        await api.marcarNoShow(recomendacion.cita_id);
      }
      await api.resolverEventoAgenda(recomendacion.evento_id, {
        estado: 'aceptada',
        accion_tomada: { tipo: recomendacion.accion },
        resultado: marcarNoShowPrimero ? 'Marcada como inasistencia' : 'Confirmado por la usuaria',
      });
    } catch (e) {
      setErrorAccion(e.message);
    } finally {
      setResolviendo(null);
    }
  }

  async function descartarEvento(recomendacion) {
    setResolviendo(recomendacion.evento_id);
    setErrorAccion(null);
    try {
      await api.resolverEventoAgenda(recomendacion.evento_id, {
        estado: 'descartada',
        accion_tomada: { tipo: 'descartar' },
        resultado: 'Descartada por la usuaria',
      });
    } catch (e) {
      setErrorAccion(e.message);
    } finally {
      setResolviendo(null);
    }
  }

  if (cargando && !estado) return <p className="operaciones-nota">TARA está revisando la agenda…</p>;
  if (error) return <p className="login-error">No se pudo cargar la agenda: {error}</p>;
  if (!estado) return null;

  const ahora = Date.now();
  const term = estado.config.terminologia;
  const retrasoIds = new Set(estado.recomendaciones.filter(r => r.tipo_regla === 'retraso').map(r => r.cita_id));
  const noShowIds = new Set(estado.recomendaciones.filter(r => r.tipo_regla === 'no_show_candidato').map(r => r.cita_id));
  const alertasActivas = estado.recomendaciones.length;

  return (
    <div>
      <div className="agenda-viva-header">
        <h1>Agenda</h1>
        <button onClick={abrirNuevaCita}>Nueva {term.bloque.singular.toLowerCase()}</button>
      </div>

      <div className="agenda-viva-console">
        <div className="agenda-viva-cmdbar">
          <span>{new Date().toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="agenda-viva-sep">│</span>
          <span>{estado.recursos.length} {term.recurso.plural.toLowerCase()}</span>
          <span className="agenda-viva-sep">│</span>
          <span>{estado.metricas.ocupacionPct}% ocupación</span>
          <span className="agenda-viva-sep">│</span>
          <span>{estado.metricas.citasRestantes} {term.bloque.plural.toLowerCase()} restantes</span>
          <span className="agenda-viva-sep">│</span>
          <span>Puntualidad hoy (aprox.): {estado.metricas.puntualidadAproxPct}%</span>
          <span className="agenda-viva-sep">│</span>
          {alertasActivas > 0
            ? <span className="agenda-viva-crit">● {alertasActivas} alerta(s)</span>
            : <span className="agenda-viva-ok">● Todo en orden</span>}
        </div>

        <div className="agenda-viva-body">
          <div className="agenda-viva-timeline">
            <div className="agenda-viva-timeline-head">
              <h5>Línea de tiempo — hoy</h5>
            </div>

            {estado.recursos.length === 0 && (
              <p className="operaciones-nota">Sin {term.recurso.plural.toLowerCase()} activas configuradas.</p>
            )}

            {estado.recursos.map((r) => {
              const nowPos = r.horario ? posicionEnJornada(new Date().toISOString(), new Date(ahora + 60000).toISOString(), r.horario) : null;
              return (
                <div className="agenda-viva-lane" key={r.asesorId}>
                  <div className="agenda-viva-lane-who">
                    <span className="agenda-viva-avatar" style={{ background: colorDesdeTexto(r.asesorNombre) }}>{iniciales(r.asesorNombre)}</span>
                    <div>
                      <span className="agenda-viva-nombre">{r.asesorNombre}</span>
                    </div>
                  </div>
                  <div className="agenda-viva-track">
                    {r.citas.filter(c => c.estado !== 'cancelada' || true).map((c) => {
                      const { leftPct, widthPct } = posicionEnJornada(c.inicio, c.fin, r.horario);
                      const clase = claseDelBloque(c, ahora, retrasoIds, noShowIds);
                      return (
                        <div key={c.id} className={`agenda-viva-blk agenda-viva-blk--${clase}`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
                          title={`${formatearHora(c.inicio, r.horario?.zona_horaria)}–${formatearHora(c.fin, r.horario?.zona_horaria)} · ${c.clientes?.nombre || c.clientes?.telefono || 'Sin nombre'}`}
                        >
                          <b>{c.clientes?.nombre || c.clientes?.telefono || term.contacto.singular}</b>
                          <span>{formatearHora(c.inicio, r.horario?.zona_horaria)}</span>
                        </div>
                      );
                    })}
                    {(r.huecos || []).map((h, i) => {
                      const { leftPct, widthPct } = posicionEnJornada(h.inicio, h.fin, r.horario);
                      return (
                        <div key={`h-${i}`} className="agenda-viva-blk agenda-viva-blk--gap"
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                          {h.minutos} min libres
                        </div>
                      );
                    })}
                    {nowPos && <div className="agenda-viva-nowline" style={{ left: `${nowPos.leftPct}%` }} />}
                  </div>
                </div>
              );
            })}

            <div className="agenda-viva-legend">
              <span><i className="agenda-viva-blk--done" />Completada</span>
              <span><i className="agenda-viva-blk--now" />En curso</span>
              <span><i className="agenda-viva-blk--late" />Retrasada</span>
              <span><i className="agenda-viva-blk--gap" />Espacio libre</span>
              <span><i className="agenda-viva-blk--cancel" />Cancelada / inasistencia</span>
            </div>
          </div>

          <div className="agenda-viva-feed">
            <h5><span className="agenda-viva-ai-dot" />TARA recomienda</h5>

            {errorAccion && <p className="login-error">{errorAccion}</p>}

            {estado.recomendaciones.length === 0 && (
              <p className="operaciones-nota">Sin recomendaciones — todo al día.</p>
            )}

            {estado.recomendaciones.map((r) => (
              <div key={r.evento_id} className={`agenda-viva-card agenda-viva-card--${r.severidad}`}>
                <span className="agenda-viva-card-sev">{r.severidad === 'critica' ? 'Crítico' : r.severidad === 'media' ? 'Atención' : 'Oportunidad'}</span>
                <p>{r.texto}</p>
                {r.detalle && <p className="agenda-viva-card-detalle">{r.detalle}</p>}
                <div className="agenda-viva-card-acciones">
                  {ACCION_BOTON[r.accion] ? (
                    <button
                      disabled={resolviendo === r.evento_id}
                      onClick={() => resolverEvento(r, { marcarNoShowPrimero: r.accion === 'marcar_no_show' })}
                    >
                      {ACCION_BOTON[r.accion]}
                    </button>
                  ) : null}
                  <button className="agenda-viva-ghost" disabled={resolviendo === r.evento_id} onClick={() => descartarEvento(r)}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="agenda-viva-kpirail">
          <div className="agenda-viva-kpi"><div className="v">{estado.metricas.ocupacionPct}%</div><div className="l">Ocupación de hoy</div></div>
          <div className="agenda-viva-kpi"><div className="v">{estado.metricas.citasRestantes}</div><div className="l">{term.bloque.plural} restantes</div></div>
          <div className="agenda-viva-kpi"><div className="v">{estado.metricas.puntualidadAproxPct}%</div><div className="l">Puntualidad (aprox.)</div></div>
          <div className="agenda-viva-kpi"><div className="v agenda-viva-nodisp">No disponible</div><div className="l">Ganancias del día — Fase 2</div></div>
          <div className="agenda-viva-kpi"><div className="v agenda-viva-nodisp">No disponible</div><div className="l">Tiempo promedio por servicio — Fase 2</div></div>
        </div>
      </div>

      {mostrarNuevaCita && (
        <NuevaCitaModal
          asesores={asesoresModal}
          clientesExistentes={clientesModal}
          fechaDefault={fecha}
          onCerrar={() => setMostrarNuevaCita(false)}
          onCreada={() => setMostrarNuevaCita(false)}
        />
      )}
    </div>
  );
}
