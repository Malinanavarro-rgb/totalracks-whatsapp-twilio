import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../adminApi';
import { usePolling } from '../../lib/usePolling';

// Modo Demo en Tiempo Real (Alina, 2026-07-30): el número oficial de
// TARA-OS sigue atendiendo todo el tráfico normal — esta pantalla solo
// activa/gestiona la ventana de tiempo en la que un teléfono autorizado es
// atendido como si fuera una empresa demo pre-armada (ver
// modules/plataforma-demo.js, migración 083). "Ver panel en vivo" reusa la
// impersonación que ya existe (adminApi.impersonar) — el super-admin ve el
// panel real de la empresa demo (Operaciones/Inbox/CRM/Agenda), no una
// pantalla aparte.
const DURACIONES = [30, 60, 90];

export default function DemoEnVivo() {
  const [empresas, setEmpresas] = useState([]);
  const [activas, setActivas] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [telefono, setTelefono] = useState('');
  const [duracion, setDuracion] = useState(60);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [resumen, setResumen] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const [empresasData, activasData] = await Promise.all([
        adminApi.empresasDemo(),
        adminApi.sesionesDemoActivas(),
      ]);
      setEmpresas(empresasData);
      setActivas(activasData);
      if (!companyId && empresasData[0]) setCompanyId(empresasData[0].id);
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
      await adminApi.activarDemo(companyId, telefono, duracion);
      setMensaje(`Demo activada para ${telefono} — ${duracion} minutos.`);
      setTelefono('');
      await cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  async function finalizar(sesionId) {
    if (!window.confirm('¿Finalizar esta sesión demo ahora?')) return;
    try {
      const sesion = await adminApi.finalizarDemo(sesionId);
      setResumen(sesion.resumen);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function verPanelEnVivo(companyIdSesion) {
    await adminApi.impersonar(companyIdSesion, 'Modo Demo en Tiempo Real');
    window.open('/operaciones', '_blank');
  }

  return (
    <div>
      <div className="pm-detalle-head">
        <div className="pm-detalle-id">
          <div>
            <h1>Demo en Tiempo Real</h1>
            <p>Un teléfono autorizado, durante una ventana de tiempo, es atendido como una empresa demo — el resto del tráfico de TARA-OS no cambia.</p>
          </div>
        </div>
      </div>

      {mensaje && <p className="pm-exito">{mensaje}</p>}
      {error && <p className="pm-error">{error}</p>}

      <div className="pm-grid-2">
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
            <label>Teléfono autorizado del prospecto
              <input value={telefono} onChange={e => setTelefono(e.target.value)} required placeholder="8112345678 (a 10 dígitos, el backend agrega +521 automáticamente)" />
            </label>
            <label>Duración
              <select value={duracion} onChange={e => setDuracion(Number(e.target.value))}>
                {DURACIONES.map(d => <option key={d} value={d}>{d} minutos</option>)}
              </select>
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
            {activas.map(sesion => (
              <div key={sesion.id} style={{ borderBottom: '1px solid var(--pm-borde, #e5e7eb)', padding: '0.9rem 1.15rem' }}>
                <div className="pm-accion-fila" style={{ padding: 0, border: 'none' }}>
                  <div className="pm-txt">
                    <b>{sesion.companies?.nombre || 'Empresa demo'}</b>
                    <span>{sesion.authorized_phone} · vence {new Date(sesion.expira_en).toLocaleString('es-MX')}</span>
                  </div>
                  <div className="pm-accion-control">
                    <button className="pm-btn pm-btn--chico" onClick={() => verPanelEnVivo(sesion.company_id)}>Ver panel en vivo</button>
                    <button className="pm-btn pm-btn--chico pm-btn--peligro" onClick={() => finalizar(sesion.id)}>Finalizar ahora</button>
                  </div>
                </div>
                <EstadoSesionEnVivo sesionId={sesion.id} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {resumen && (
        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Resumen de la última sesión finalizada</h2></div>
          <div className="pm-campo-lista">
            <div className="pm-campo-fila"><span className="l">Cliente registrado</span><span className="v">{resumen.cliente?.nombre || 'Ninguno (nadie escribió durante la ventana)'}</span></div>
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

// Estado en vivo del prospecto REAL de esta sesión — filtrado por
// authorized_phone en el backend, nunca mezclado con los clientes
// sembrados de la misma empresa demo (Alina, 2026-07-30). Polling de 4s,
// mismo patrón que Operaciones/Inbox/CRM.
function EstadoSesionEnVivo({ sesionId }) {
  const { datos: estado, cargando } = usePolling(() => adminApi.estadoSesionDemo(sesionId), 4000);

  if (cargando) return <p className="pm-nota" style={{ margin: '0.6rem 0 0' }}>Cargando estado en vivo…</p>;
  if (!estado?.cliente) return <p className="pm-nota" style={{ margin: '0.6rem 0 0' }}>Nadie ha escrito todavía desde este número.</p>;

  const { cliente, oportunidades, citas, conversaciones, datos_extraidos, nodo_actual } = estado;

  return (
    <div style={{ marginTop: '0.7rem', paddingLeft: '0.1rem', display: 'grid', gap: '0.5rem' }}>
      <div className="pm-campo-fila"><span className="l">Cliente real de esta sesión</span><span className="v">{cliente.nombre} · {cliente.telefono}</span></div>
      {nodo_actual && <div className="pm-campo-fila"><span className="l">Paso actual del flujo</span><span className="v">{nodo_actual}</span></div>}
      {Object.keys(datos_extraidos || {}).length > 0 && (
        <div className="pm-campo-fila"><span className="l">Datos capturados</span><span className="v">{Object.entries(datos_extraidos).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></div>
      )}
      <div className="pm-campo-fila"><span className="l">Oportunidad</span><span className="v">{oportunidades[0] ? oportunidades[0].estado : 'Ninguna todavía'}</span></div>
      <div className="pm-campo-fila"><span className="l">Cita</span><span className="v">{citas[0] ? `${new Date(citas[0].inicio).toLocaleString('es-MX')} (${citas[0].estado})` : 'Ninguna todavía'}</span></div>
      {conversaciones.length > 0 && (
        <details>
          <summary className="pm-nota-inline" style={{ cursor: 'pointer' }}>Conversación en vivo ({conversaciones.length})</summary>
          <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.35rem' }}>
            {conversaciones.map((c, i) => (
              <div key={i} style={{ fontSize: '0.85rem' }}>
                <div><b>Cliente:</b> {c.mensaje_cliente}</div>
                <div><b>TARA:</b> {c.respuesta_tara}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
