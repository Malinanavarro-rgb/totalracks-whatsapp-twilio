import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Portal del Cliente — "Explorar herramientas" (TARA Module Engine, Fase
// 3.3/3.4). Mismo criterio que SuscripcionTab: reusa las funciones del
// backend en modo lectura + las acciones puntuales (activar/solicitar),
// nunca escribe planes/suscripciones directo.
const ETIQUETA_CATEGORIA = {
  ventas: 'Ventas', operacion: 'Operación', postventa: 'Postventa', plataforma: 'Plataforma',
};
const ETIQUETA_ESTADO = { activo: 'En uso', integrado: 'Integrado', inactivo: 'Sin activar' };
// Estados reales del backend (solicitudes_ampliacion.estado, migración 131)
// — no se inventa ninguno nuevo aquí.
const ETIQUETA_SOLICITUD = { pendiente: 'Pendiente de revisión', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const PILL_SOLICITUD = { pendiente: 'pill--warning', aprobada: 'pill--success', rechazada: 'pill--neutral' };

function formatearFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HerramientasTab() {
  const [modulos, setModulos] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState(null);
  const [solicitandoCodigo, setSolicitandoCodigo] = useState(null);

  // "Mis solicitudes" siempre se recarga al entrar a la pestaña — es la
  // forma en que la empresa "consulta inmediatamente" el resultado una vez
  // que Super Admin aprueba/rechaza (no existe un mecanismo de notificación
  // push en el panel hoy — ver nota en el reporte de entrega).
  function cargar() {
    Promise.all([api.modulosEmpresa(), api.solicitudesAmpliacionEmpresa()])
      .then(([m, s]) => { setModulos(m); setSolicitudes(s); })
      .catch(e => setError(e.message));
  }

  useEffect(cargar, []);

  async function activar(modulo) {
    setError(null);
    setEnviandoCodigo(modulo.codigo);
    try {
      await api.activarModulo(modulo.codigo);
      setMensaje(`"${modulo.nombre}" activado.`);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviandoCodigo(null);
    }
  }

  async function solicitarAmpliacion(modulo) {
    setError(null);
    setSolicitandoCodigo(modulo.codigo);
    try {
      await api.solicitarAmpliacion(modulo.codigo);
      setMensaje(`Solicitud enviada para "${modulo.nombre}" — consulta el estado en "Mis solicitudes".`);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setSolicitandoCodigo(null);
    }
  }

  if (error && !modulos) return <p className="login-error">No se pudieron cargar las herramientas: {error}</p>;
  if (!modulos || !solicitudes) return <p className="operaciones-nota">Cargando…</p>;

  const categorias = [...new Set(modulos.map(m => m.categoria || 'otros'))];
  // Nunca duplicar una solicitud pendiente del mismo módulo (el backend ya
  // lo bloquea con 409 — esto solo evita mostrar un botón que fallaría).
  const modulosConSolicitudPendiente = new Set(solicitudes.filter(s => s.estado === 'pendiente' && s.modulo_codigo).map(s => s.modulo_codigo));

  return (
    <div>
      {error && <p className="login-error">{error}</p>}
      {mensaje && <p className="operaciones-nota">{mensaje}</p>}

      {categorias.map(cat => (
        <section className="crm-seccion" key={cat}>
          <h2>{ETIQUETA_CATEGORIA[cat] || cat}</h2>
          <ul className="config-kb-lista">
            {modulos.filter(m => (m.categoria || 'otros') === cat).map(m => (
              <li className="config-kb-item" key={m.codigo}>
                <strong>{m.nombre}</strong> — {m.descripcion}
                {' '}<span className={`pill ${m.estado === 'inactivo' ? 'pill--neutral' : 'pill--success'}`}>{ETIQUETA_ESTADO[m.estado] || m.estado}</span>
                {m.estado === 'inactivo' && m.incluido_en_plan && (
                  <button onClick={() => activar(m)} disabled={enviandoCodigo === m.codigo} style={{ marginLeft: '0.6rem' }}>
                    {enviandoCodigo === m.codigo ? 'Activando…' : 'Activar'}
                  </button>
                )}
                {!m.incluido_en_plan && (
                  modulosConSolicitudPendiente.has(m.codigo) ? (
                    <span className="pill pill--warning" style={{ marginLeft: '0.6rem' }}>Solicitud enviada</span>
                  ) : (
                    <button onClick={() => solicitarAmpliacion(m)} disabled={solicitandoCodigo === m.codigo} style={{ marginLeft: '0.6rem' }}>
                      {solicitandoCodigo === m.codigo ? 'Enviando…' : 'Solicitar ampliación'}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="crm-seccion">
        <h2>Mis solicitudes</h2>
        {solicitudes.length === 0 && <p className="operaciones-nota">Sin solicitudes todavía.</p>}
        {solicitudes.length > 0 && (
          <ul className="config-kb-lista">
            {solicitudes.map(s => (
              <li className="config-kb-item" key={s.id}>
                <strong>{s.modulos_catalogo?.nombre || s.modulo_codigo || 'Ampliación general'}</strong>
                {' '}— {formatearFecha(s.created_at)}
                {' '}<span className={`pill ${PILL_SOLICITUD[s.estado] || 'pill--neutral'}`}>{ETIQUETA_SOLICITUD[s.estado] || s.estado}</span>
                {s.estado !== 'pendiente' && s.notas_revision && <div className="operaciones-nota">{s.notas_revision}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
