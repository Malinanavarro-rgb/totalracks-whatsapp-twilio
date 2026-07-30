import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePolling } from '../lib/usePolling';
import LogoTara from '../components/LogoTara';
import { obtenerEstadoDemo } from './demoLiveApi';
import './demo-live.css';

// Demo Live View (Alina, 2026-07-30): pantalla pública, sin login, 100% de
// solo lectura — pensada para que un prospecto observe a TARA trabajar en
// tiempo real durante una demostración comercial. Nunca comparte el Panel
// Maestro ni el CRM interno; todo lo que se ve aquí viene ya curado por
// modules/plataforma-demo.js::obtenerEstadoPublico() (teléfonos
// enmascarados, sin ids internos). Polling de 4s — mismo mecanismo "en
// tiempo real" que usa el resto del panel (Operaciones/Inbox/CRM).

function useCuentaRegresiva(expiraEn) {
  const [restanteMs, setRestanteMs] = useState(null);
  useEffect(() => {
    if (!expiraEn) return;
    const tick = () => setRestanteMs(Math.max(0, new Date(expiraEn).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiraEn]);
  return restanteMs;
}

function formatearRestante(ms) {
  if (ms == null) return '—';
  const totalSeg = Math.floor(ms / 1000);
  const m = Math.floor(totalSeg / 60);
  const s = totalSeg % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "Lo que TARA está haciendo" — heurística sin backend nuevo: si el
 * evento más reciente del participante es un mensaje del cliente sin una
 * respuesta posterior y tiene <15s, se asume que está en proceso. */
function inferirActividad(conversaciones) {
  if (!conversaciones || conversaciones.length === 0) return null;
  const ultima = conversaciones[conversaciones.length - 1];
  const edadMs = Date.now() - new Date(ultima.created_at).getTime();
  if (!ultima.respuesta_tara && edadMs < 15000) return 'Lucía está escribiendo…';
  return null;
}

const ETIQUETA_ESTADO_PARTICIPANTE = {
  autorizado: 'Autorizado', activo: 'En conversación', pausado: 'Pausado', bloqueado: 'Bloqueado', finalizado: 'Finalizado',
};

export default function DemoLiveApp() {
  const { token } = useParams();
  const { datos: estado, error, cargando } = usePolling(() => obtenerEstadoDemo(token), 4000);
  const [seleccionado, setSeleccionado] = useState(null);
  const restanteMs = useCuentaRegresiva(estado?.estado === 'activa' ? estado?.expira_en : null);

  const participanteSeleccionado = useMemo(
    () => estado?.participantes?.find(p => p.id === seleccionado) || estado?.participantes?.[0] || null,
    [estado, seleccionado]
  );

  if (cargando) return <div className="dlv-pantalla-centrada"><LogoTara size={48} /><p>Cargando demostración…</p></div>;
  if (error || !estado) return <div className="dlv-pantalla-centrada"><LogoTara size={48} /><p>Esta demostración ya no está disponible.</p></div>;

  if (estado.estado === 'finalizada') {
    return <CierreDemo estado={estado} />;
  }

  return (
    <div className="dlv-root">
      <header className="dlv-header">
        <div className="dlv-header-marca"><LogoTara size={36} /><span>TARA-OS</span></div>
        <div className="dlv-header-info">
          <h1>{estado.empresa_nombre}</h1>
          <div className="dlv-header-meta">
            <span className="dlv-chip dlv-chip--vivo"><i />En vivo</span>
            <span>Termina en {formatearRestante(restanteMs)}</span>
          </div>
        </div>
      </header>

      <section className="dlv-metricas">
        <Metrica etiqueta="Conversaciones activas" valor={estado.metricas.conversaciones_activas} />
        <Metrica etiqueta="Clientes registrados" valor={estado.metricas.clientes_registrados} />
        <Metrica etiqueta="Oportunidades" valor={estado.metricas.oportunidades_creadas} />
        <Metrica etiqueta="Citas agendadas" valor={estado.metricas.citas_agendadas} />
        <Metrica etiqueta="Procesos ejecutados" valor={estado.metricas.procesos_ejecutados} />
        {estado.metricas.tiempo_promedio_respuesta_ms != null && (
          <Metrica etiqueta="Respuesta promedio" valor={`${(estado.metricas.tiempo_promedio_respuesta_ms / 1000).toFixed(1)}s`} />
        )}
      </section>

      <section className="dlv-cuerpo">
        <div className="dlv-columna-participantes">
          <h2>Conversaciones</h2>
          {estado.participantes.length === 0 && <p className="dlv-nota">Todavía no hay participantes autorizados.</p>}
          {estado.participantes.map(p => (
            <button
              key={p.id}
              className={`dlv-tarjeta-participante ${participanteSeleccionado?.id === p.id ? 'dlv-tarjeta-participante--activa' : ''}`}
              onClick={() => setSeleccionado(p.id)}
            >
              <div className="dlv-tarjeta-participante-nombre">{p.nombre}</div>
              <div className="dlv-tarjeta-participante-meta">{p.escenario || 'Sin escenario'}</div>
              <div className="dlv-tarjeta-participante-estado">{ETIQUETA_ESTADO_PARTICIPANTE[p.estado_participante] || p.estado_participante}</div>
              {p.oportunidad && <div className="dlv-tarjeta-participante-accion">{p.oportunidad.estado}</div>}
            </button>
          ))}
        </div>

        <div className="dlv-columna-detalle">
          {participanteSeleccionado ? <DetalleParticipante participante={participanteSeleccionado} /> : <p className="dlv-nota">Selecciona una conversación.</p>}
        </div>

        <div className="dlv-columna-lateral">
          <h2>Línea de tiempo</h2>
          <div className="dlv-timeline">
            {estado.linea_tiempo.length === 0 && <p className="dlv-nota">Sin actividad todavía.</p>}
            {estado.linea_tiempo.slice().reverse().map((ev, i) => (
              <div key={i} className="dlv-timeline-item">
                <span className="dlv-timeline-hora">{new Date(ev.hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className="dlv-timeline-texto"><b>{ev.participante}</b> {ev.texto}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metrica({ etiqueta, valor }) {
  return (
    <div className="dlv-metrica">
      <div className="dlv-metrica-valor">{valor}</div>
      <div className="dlv-metrica-etiqueta">{etiqueta}</div>
    </div>
  );
}

function DetalleParticipante({ participante }) {
  const actividad = inferirActividad(participante.conversaciones);

  return (
    <div className="dlv-detalle">
      <div className="dlv-detalle-head">
        <h2>{participante.nombre}</h2>
        <span className="dlv-nota-inline">{participante.telefono_enmascarado}</span>
      </div>

      {actividad && <div className="dlv-actividad-viva">✨ {actividad}</div>}

      <div className="dlv-detalle-chat">
        {(participante.conversaciones || []).length === 0 && <p className="dlv-nota">Sin mensajes todavía.</p>}
        {(participante.conversaciones || []).map((c, i) => (
          <div key={i} className="dlv-chat-turno">
            <div className="dlv-chat-burbuja dlv-chat-burbuja--cliente">{c.mensaje_cliente}</div>
            {c.respuesta_tara && <div className="dlv-chat-burbuja dlv-chat-burbuja--tara">{c.respuesta_tara}</div>}
          </div>
        ))}
      </div>

      <div className="dlv-detalle-grid">
        <div className="dlv-detalle-bloque">
          <h3>Datos extraídos</h3>
          {Object.keys(participante.datos_extraidos || {}).length === 0
            ? <p className="dlv-nota">Ninguno todavía.</p>
            : <ul>{Object.entries(participante.datos_extraidos).map(([k, v]) => <li key={k}><b>{k}:</b> {String(v)}</li>)}</ul>}
        </div>
        <div className="dlv-detalle-bloque">
          <h3>Información pendiente</h3>
          {(participante.campos_pendientes || []).length === 0
            ? <p className="dlv-nota">Calificación completa.</p>
            : <ul>{participante.campos_pendientes.map(c => <li key={c}>{c}</li>)}</ul>}
        </div>
        <div className="dlv-detalle-bloque">
          <h3>Oportunidad</h3>
          {participante.oportunidad
            ? <p>{participante.oportunidad.estado} — {participante.oportunidad.descripcion}</p>
            : <p className="dlv-nota">Ninguna todavía.</p>}
        </div>
        <div className="dlv-detalle-bloque">
          <h3>Agenda</h3>
          {participante.cita
            ? <p>{new Date(participante.cita.inicio).toLocaleString('es-MX')} — {participante.cita.estado}</p>
            : <p className="dlv-nota">Sin cita todavía.</p>}
        </div>
      </div>
    </div>
  );
}

function CierreDemo({ estado }) {
  const resumen = estado.resumen || {};
  return (
    <div className="dlv-cierre">
      <LogoTara size={56} />
      <h1>Demostración finalizada</h1>
      <p className="dlv-nota">{estado.empresa_nombre}</p>

      <div className="dlv-cierre-metricas">
        <Metrica etiqueta="⏱️ Duración" valor={`${Math.round((resumen.duracion_ms || 0) / 60000)} min`} />
        <Metrica etiqueta="👤 Clientes registrados" valor={resumen.clientes_registrados || 0} />
        <Metrica etiqueta="🎯 Oportunidades creadas" valor={resumen.oportunidades?.length || 0} />
        <Metrica etiqueta="📅 Citas agendadas" valor={resumen.citas?.length || 0} />
        <Metrica etiqueta="🤖 Procesos ejecutados" valor={Object.values(resumen.acciones_por_tipo || {}).reduce((a, b) => a + b, 0)} />
      </div>

      <Link to="/registro" className="dlv-cta">Activar TARA-OS para mi empresa</Link>
    </div>
  );
}
