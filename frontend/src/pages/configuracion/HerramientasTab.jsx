import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Portal del Cliente — "Explorar herramientas" (TARA Module Engine, Fase
// 3.3/3.4). Mismo criterio que SuscripcionTab: reusa las funciones del
// backend en modo lectura + las 2 acciones puntuales (activar/solicitar),
// nunca escribe planes/suscripciones directo.
const ETIQUETA_CATEGORIA = {
  ventas: 'Ventas', operacion: 'Operación', postventa: 'Postventa', plataforma: 'Plataforma',
};
const ETIQUETA_ESTADO = { activo: 'En uso', integrado: 'Integrado', inactivo: 'Sin activar' };

export default function HerramientasTab() {
  const [modulos, setModulos] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState(null);
  const [solicitandoCodigo, setSolicitandoCodigo] = useState(null);

  function cargar() {
    api.modulosEmpresa().then(setModulos).catch(e => setError(e.message));
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
      setMensaje(`Solicitud enviada para "${modulo.nombre}" — te avisaremos cuando la revisemos.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSolicitandoCodigo(null);
    }
  }

  if (error && !modulos) return <p className="login-error">No se pudieron cargar las herramientas: {error}</p>;
  if (!modulos) return <p className="operaciones-nota">Cargando…</p>;

  const categorias = [...new Set(modulos.map(m => m.categoria || 'otros'))];

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
                  <button onClick={() => solicitarAmpliacion(m)} disabled={solicitandoCodigo === m.codigo} style={{ marginLeft: '0.6rem' }}>
                    {solicitandoCodigo === m.codigo ? 'Enviando…' : 'Solicitar ampliación'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
