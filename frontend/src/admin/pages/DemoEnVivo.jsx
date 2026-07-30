import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../adminApi';

// Modo Demo en Tiempo Real + Demo Live View (Alina, 2026-07-30): el número
// oficial de TARA-OS sigue atendiendo todo el tráfico normal — esta
// pantalla activa/gestiona la ventana de tiempo y los teléfonos
// autorizados ("participantes") de una empresa demo. Una sesión ya no es
// "un teléfono" — es un tablero con N participantes, cada uno una
// conversación completamente independiente (ver modules/plataforma-demo.js).
// "Abrir Demo Live View" abre la URL pública (/demo-live/:token) en una
// pestaña aparte — esa es la pantalla que se comparte con el prospecto,
// nunca el Panel Maestro.
const DURACIONES = [30, 60, 90];
const ESTADOS_PARTICIPANTE = [
  { valor: 'pausado', etiqueta: 'Pausar' },
  { valor: 'bloqueado', etiqueta: 'Bloquear' },
  { valor: 'activo', etiqueta: 'Reactivar' },
  { valor: 'finalizado', etiqueta: 'Finalizar' },
];

export default function DemoEnVivo() {
  const [empresas, setEmpresas] = useState([]);
  const [activas, setActivas] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [duracion, setDuracion] = useState(60);
  const [maxParticipantes, setMaxParticipantes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [participantesPorSesion, setParticipantesPorSesion] = useState({});
  const [formParticipante, setFormParticipante] = useState({});

  const cargar = useCallback(async () => {
    try {
      const [empresasData, activasData] = await Promise.all([
        adminApi.empresasDemo(),
        adminApi.sesionesDemoActivas(),
      ]);
      setEmpresas(empresasData);
      setActivas(activasData);
      if (!companyId && empresasData[0]) setCompanyId(empresasData[0].id);

      const listas = await Promise.all(activasData.map(s => adminApi.participantesDemo(s.id).catch(() => [])));
      const mapa = {};
      activasData.forEach((s, i) => { mapa[s.id] = listas[i]; });
      setParticipantesPorSesion(mapa);
    } catch (e) {
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function activar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      await adminApi.activarDemo(companyId, duracion, maxParticipantes ? Number(maxParticipantes) : null);
      setMensaje('Demo activada — agrega a los participantes autorizados abajo.');
      await cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  async function finalizarSesion(sesionId) {
    if (!window.confirm('¿Finalizar toda la sesión demo ahora? Esto cierra a todos los participantes a la vez.')) return;
    try {
      const sesion = await adminApi.finalizarDemo(sesionId);
      setResumen(sesion.resumen);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  function abrirDemoLiveView(publicToken) {
    window.open(`/demo-live/${publicToken}`, '_blank');
  }

  async function agregarParticipante(sesionId, e) {
    e.preventDefault();
    const datos = formParticipante[sesionId] || {};
    if (!datos.phone) return;
    try {
      await adminApi.agregarParticipanteDemo(sesionId, datos);
      setFormParticipante(prev => ({ ...prev, [sesionId]: { phone: '', displayName: '', scenario: '' } }));
      await cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function cambiarEstadoParticipante(sesionId, participantId, status) {
    try {
      await adminApi.actualizarParticipanteDemo(sesionId, participantId, status);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function limpiarDatos(sesionId, participantId) {
    if (!window.confirm('¿Borrar todos los datos de este participante (cliente, conversación, oportunidad, cita)? Sigue autorizado para empezar de cero.')) return;
    try {
      await adminApi.limpiarDatosParticipanteDemo(sesionId, participantId);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="pm-detalle-head">
        <div className="pm-detalle-id">
          <div>
            <h1>Demo en Tiempo Real</h1>
            <p>Uno o varios teléfonos autorizados, durante una ventana de tiempo, son atendidos como una empresa demo — el resto del tráfico de TARA-OS no cambia.</p>
          </div>
        </div>
      </div>

      {mensaje && <p className="pm-exito">{mensaje}</p>}
      {error && <p className="pm-error">{error}</p>}

      <div className="pm-panel">
        <div className="pm-panel-head"><h2>Activar demo en tiempo real</h2></div>
        <form className="pm-form-inline" onSubmit={activar} style={{ padding: '0 1.15rem 1.1rem' }}>
          <label>Empresa demo
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} required>
              {empresas.length === 0 && <option value="">Sin empresas demo configuradas</option>}
              {empresas.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.nombre} {emp.industria_slug ? `(${emp.industria_slug})` : ''}</option>
              ))}
            </select>
          </label>
          <label>Duración
            <select value={duracion} onChange={e => setDuracion(Number(e.target.value))}>
              {DURACIONES.map(d => <option key={d} value={d}>{d} minutos</option>)}
            </select>
          </label>
          <label>Máximo de participantes (opcional)
            <input type="number" min="1" value={maxParticipantes} onChange={e => setMaxParticipantes(e.target.value)} placeholder="Sin límite" style={{ width: 120 }} />
          </label>
          <button className="pm-btn pm-btn--primario" disabled={enviando || !companyId}>
            {enviando ? 'Activando…' : 'Activar demo en tiempo real'}
          </button>
        </form>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-head"><h2>Sesiones activas</h2><span className="n">{activas.length}</span></div>
        <div className="pm-panel-body">
          {activas.length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin sesiones demo vigentes.</p>}
          {activas.map(sesion => {
            const participantes = participantesPorSesion[sesion.id] || [];
            const formActual = formParticipante[sesion.id] || { phone: '', displayName: '', scenario: '' };

            return (
              <div key={sesion.id} style={{ borderBottom: '1px solid var(--pm-borde, #e5e7eb)', padding: '0.9rem 1.15rem' }}>
                <div className="pm-accion-fila" style={{ padding: 0, border: 'none' }}>
                  <div className="pm-txt">
                    <b>{sesion.companies?.nombre || 'Empresa demo'}</b>
                    <span>vence {new Date(sesion.expira_en).toLocaleString('es-MX')} · {participantes.length}{sesion.max_participantes ? `/${sesion.max_participantes}` : ''} participante(s)</span>
                  </div>
                  <div className="pm-accion-control">
                    <button className="pm-btn pm-btn--chico pm-btn--primario" onClick={() => abrirDemoLiveView(sesion.public_token)}>Abrir Demo Live View</button>
                    <button className="pm-btn pm-btn--chico pm-btn--peligro" onClick={() => finalizarSesion(sesion.id)}>Finalizar sesión completa</button>
                  </div>
                </div>

                <div style={{ marginTop: '0.7rem', display: 'grid', gap: '0.5rem' }}>
                  {participantes.map(p => (
                    <div key={p.id} className="pm-accion-fila" style={{ padding: '0.5rem 0' }}>
                      <div className="pm-txt">
                        <b>{p.display_name || p.phone}</b>
                        <span>{p.phone} · {p.scenario || 'sin escenario'} · <span className={`pm-pill ${p.status === 'activo' ? 'pm-pill--ok' : p.status === 'bloqueado' ? 'pm-pill--danger' : 'pm-pill--muted'}`}><i />{p.status}</span></span>
                      </div>
                      <div className="pm-accion-control">
                        {ESTADOS_PARTICIPANTE.filter(o => o.valor !== p.status).map(o => (
                          <button key={o.valor} className="pm-btn pm-btn--chico" onClick={() => cambiarEstadoParticipante(sesion.id, p.id, o.valor)}>{o.etiqueta}</button>
                        ))}
                        <button className="pm-btn pm-btn--chico" onClick={() => limpiarDatos(sesion.id, p.id)}>Limpiar datos</button>
                      </div>
                    </div>
                  ))}

                  <form className="pm-form-inline" onSubmit={e => agregarParticipante(sesion.id, e)} style={{ marginTop: '0.4rem' }}>
                    <input
                      placeholder="Teléfono (8112345678)" value={formActual.phone}
                      onChange={e => setFormParticipante(prev => ({ ...prev, [sesion.id]: { ...formActual, phone: e.target.value } }))}
                      style={{ width: 160 }} required
                    />
                    <input
                      placeholder="Nombre del escenario (ej. Cliente residencial)" value={formActual.displayName}
                      onChange={e => setFormParticipante(prev => ({ ...prev, [sesion.id]: { ...formActual, displayName: e.target.value } }))}
                      style={{ width: 220 }}
                    />
                    <input
                      placeholder="Escenario (ej. Residencial — ahorro)" value={formActual.scenario}
                      onChange={e => setFormParticipante(prev => ({ ...prev, [sesion.id]: { ...formActual, scenario: e.target.value } }))}
                      style={{ width: 200 }}
                    />
                    <button className="pm-btn pm-btn--chico">Agregar participante</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {resumen && (
        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Resumen de la última sesión finalizada</h2></div>
          <div className="pm-campo-lista">
            <div className="pm-campo-fila"><span className="l">Participantes</span><span className="v">{resumen.participantes}</span></div>
            <div className="pm-campo-fila"><span className="l">Clientes registrados</span><span className="v">{resumen.clientes_registrados}</span></div>
            <div className="pm-campo-fila"><span className="l">Duración</span><span className="v">{Math.round(resumen.duracion_ms / 60000)} min</span></div>
            <div className="pm-campo-fila"><span className="l">Oportunidades creadas</span><span className="v">{resumen.oportunidades?.length || 0}</span></div>
            <div className="pm-campo-fila"><span className="l">Citas agendadas</span><span className="v">{resumen.citas?.length || 0}</span></div>
            <div className="pm-campo-fila"><span className="l">Acciones ejecutadas</span><span className="v">{Object.entries(resumen.acciones_por_tipo || {}).map(([tipo, n]) => `${tipo}: ${n}`).join(' · ') || '—'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
