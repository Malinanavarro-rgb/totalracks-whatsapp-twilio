import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { iniciales, colorDesdeTexto } from '../lib/avatar';

// Estado del cliente → severidad visual del pill (Brand Guidelines V1.0:
// colores semánticos, no un color por estado inventado).
const SEVERIDAD_ESTADO = {
  Ganado: 'success',
  Perdido: 'error',
  Negociacion: 'warning',
};

function tiempoRelativo(iso) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'hace 1 día';
  return `hace ${dias} días`;
}

function formatearMonto(monto) {
  if (monto == null) return null;
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

// Motor Universal: industrias de citas (ej. salon_belleza) cuentan la
// historia de la fila con fecha/hora de la próxima cita en vez de un monto
// (ver ui_config.crm.layout === 'citas' abajo).
function formatearFechaCita(iso) {
  if (!iso) return null;
  const fecha = new Date(iso);
  const dia = fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const hora = fecha.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  return `${dia}, ${hora}`;
}

function AvatarCliente({ nombre, logo_url }) {
  if (logo_url) return <img className="cliente-logo" src={logo_url} alt={nombre} />;
  return (
    <span className="cliente-logo cliente-logo--iniciales" style={{ background: colorDesdeTexto(nombre) }}>
      {iniciales(nombre)}
    </span>
  );
}

// Fase 5: lista de clientes. La ficha completa (conversaciones + citas +
// oportunidades + seguimientos) vive en /crm/clientes/:id.
// Pivote a producto, Fase 2.4: búsqueda/filtros resueltos server-side
// (modules/crm-ui.js::listarClientes) — con debounce simple para no
// disparar una consulta por cada tecla.
// Fase Premium V1.1: cada fila cuenta una historia (última actividad,
// monto, próxima acción) en vez de solo nombre/teléfono — datos reales de
// modules/crm-ui.js::listarClientes (ultima_oportunidad), no inventados.
export default function Crm() {
  const { sesion } = useAuth();
  // Motor Universal: título, columnas y layout (citas vs. cotización) vienen
  // de la plantilla de industria (plantillas_industria.ui_config.crm) — sin
  // esa config (empresa sin industria) se usa el criterio genérico universal.
  const crmConfig = sesion?.empresaActiva?.ui_config?.crm;
  const tituloSeccion = crmConfig?.titulo || 'Ventas';
  const layoutCitas = crmConfig?.layout === 'citas';
  const columnas = crmConfig?.columnas || ['Cliente', 'Última actividad', 'Monto', 'Próxima acción', 'Estado'];
  const mostrarLinkPipeline = crmConfig?.mostrarLinkPipeline ?? true;
  const [clientes, setClientes] = useState(null);
  const [error, setError] = useState(null);
  const [filtros, setFiltros] = useState({ nombre: '', estado: '', score_min: '' });
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ telefono: '', nombre: '', empresa: '' });

  useEffect(() => {
    const timeout = setTimeout(() => {
      api.clientesCrm(filtros).then(setClientes).catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timeout);
  }, [filtros]);

  // Fase Demo Comercial: el panel debe reflejar clientes/oportunidades
  // nuevas mientras un cliente conversa por WhatsApp, sin recargar a mano.
  useEffect(() => {
    const id = setInterval(() => {
      api.clientesCrm(filtros).then(setClientes).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [filtros]);

  async function crearCliente(e) {
    e.preventDefault();
    if (!nuevoCliente.telefono.trim()) return;
    try {
      await api.crearClienteManual(nuevoCliente);
      setNuevoCliente({ telefono: '', nombre: '', empresa: '' });
      setMostrarNuevo(false);
      api.clientesCrm(filtros).then(setClientes);
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>{tituloSeccion}</h1>
        <div>
          <button onClick={() => setMostrarNuevo(!mostrarNuevo)}>{mostrarNuevo ? 'Cancelar' : 'Nuevo cliente'}</button>
          {mostrarLinkPipeline && (
            <>
              {' '}
              <NavLink to="/crm/pipeline">Ver proceso comercial</NavLink>
            </>
          )}
        </div>
      </div>

      {mostrarNuevo && (
        <form className="config-form-inline" onSubmit={crearCliente}>
          <input
            type="text" placeholder="Teléfono (con código de país)" required
            value={nuevoCliente.telefono} onChange={(e) => setNuevoCliente({ ...nuevoCliente, telefono: e.target.value })}
          />
          <input
            type="text" placeholder="Nombre"
            value={nuevoCliente.nombre} onChange={(e) => setNuevoCliente({ ...nuevoCliente, nombre: e.target.value })}
          />
          <input
            type="text" placeholder="Empresa (opcional)"
            value={nuevoCliente.empresa} onChange={(e) => setNuevoCliente({ ...nuevoCliente, empresa: e.target.value })}
          />
          <button type="submit">Crear</button>
        </form>
      )}

      <form className="config-form-inline" onSubmit={(e) => e.preventDefault()}>
        <input
          type="text" placeholder="Buscar por nombre o teléfono…"
          value={filtros.nombre} onChange={(e) => setFiltros({ ...filtros, nombre: e.target.value })}
        />
        <input
          type="text" placeholder="Estado exacto (ej. Nuevo)"
          value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
        />
        <input
          type="number" min="0" max="100" placeholder="Score mínimo"
          value={filtros.score_min} onChange={(e) => setFiltros({ ...filtros, score_min: e.target.value })}
        />
      </form>

      {error && <p className="login-error">{error}</p>}
      {clientes === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {clientes?.length === 0 && <p className="operaciones-nota">No hay clientes que coincidan.</p>}

      {clientes && clientes.length > 0 && (
        <>
        <div className="clientes-header">
          {columnas.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="clientes-lista">
          {clientes.map((c) => {
            const op = c.ultima_oportunidad;
            const severidad = SEVERIDAD_ESTADO[c.estado] || 'neutral';
            return (
              <NavLink key={c.id} to={`/crm/clientes/${c.id}`} className="cliente-fila">
                <AvatarCliente nombre={c.nombre || c.telefono} logo_url={c.logo_url} />
                <div className="cliente-fila-nombre">
                  <strong>{c.nombre || c.telefono}</strong>
                  <span className="cliente-fila-detalle">{c.empresa ? `${c.empresa} · ` : ''}{c.telefono}</span>
                </div>
                {layoutCitas ? (
                  <>
                    <span className="cliente-fila-actividad">{formatearFechaCita(c.proxima_cita?.inicio) || '—'}</span>
                    <span className="cliente-fila-monto">{tiempoRelativo(c.ultima_cita) || '—'}</span>
                    <span className="cliente-fila-accion">
                      {c.proxima_cita?.estado === 'agendada' ? 'Confirmar' : c.proxima_cita ? 'Confirmada' : '—'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="cliente-fila-actividad">{tiempoRelativo(op?.actualizado) || '—'}</span>
                    <span className="cliente-fila-monto">{formatearMonto(op?.monto) || '—'}</span>
                    <span className="cliente-fila-accion">{op?.proxima_accion || '—'}</span>
                  </>
                )}
                <span className={`pill pill--${severidad}`}>{c.estado || 'Nuevo'}</span>
              </NavLink>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
