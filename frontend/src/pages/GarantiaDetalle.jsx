import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

const ETIQUETA_ESTADO_RECLAMACION = { abierta: 'Abierta', en_revision: 'En revisión', aprobada: 'Aprobada', rechazada: 'Rechazada', resuelta: 'Resuelta' };
const SEVERIDAD_ESTADO_RECLAMACION = { aprobada: 'success', resuelta: 'success', rechazada: 'error', en_revision: 'warning', abierta: 'neutral' };
const ESTADOS_RECLAMACION = ['abierta', 'en_revision', 'aprobada', 'rechazada', 'resuelta'];

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Una reclamación con su línea de tiempo — expandible, cambio de estado y
// nuevo comentario inline (sin navegar a otra pantalla).
function TarjetaReclamacion({ reclamacion, onCambio }) {
  const [abierta, setAbierta] = useState(false);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function cambiarEstado(estado) {
    setError(null);
    try {
      await api.actualizarEstadoReclamacion(reclamacion.id, estado);
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  async function enviarComentario(e) {
    e.preventDefault();
    if (!comentario.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await api.comentarReclamacion(reclamacion.id, comentario.trim());
      setComentario('');
      onCambio();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li className="config-kb-item">
      <div className="crm-seccion-header">
        <span>
          <span className={`pill pill--${SEVERIDAD_ESTADO_RECLAMACION[reclamacion.estado] || 'neutral'}`}>{ETIQUETA_ESTADO_RECLAMACION[reclamacion.estado]}</span>
          {' '}{reclamacion.descripcion} <span className="operaciones-nota">— {formatearFechaHora(reclamacion.created_at)}</span>
        </span>
        <button type="button" className="boton-enlace" onClick={() => setAbierta(!abierta)}>{abierta ? 'Ocultar' : 'Ver línea de tiempo'}</button>
      </div>

      {abierta && (
        <div>
          {error && <p className="login-error">{error}</p>}
          <ul className="config-kb-lista">
            {reclamacion.eventos.map((ev) => (
              <li key={ev.id} className="config-kb-item">
                <span className="operaciones-nota">{formatearFechaHora(ev.created_at)}</span> — {ev.texto}
              </li>
            ))}
          </ul>

          <div className="config-form-inline">
            <select onChange={(e) => e.target.value && cambiarEstado(e.target.value)} value="">
              <option value="">Cambiar estado…</option>
              {ESTADOS_RECLAMACION.filter((e) => e !== reclamacion.estado).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_RECLAMACION[e]}</option>)}
            </select>
          </div>

          <form className="config-form-inline" onSubmit={enviarComentario}>
            <input type="text" placeholder="Agregar comentario…" value={comentario} onChange={(e) => setComentario(e.target.value)} />
            <button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Comentar'}</button>
          </form>
        </div>
      )}
    </li>
  );
}

export default function GarantiaDetalle() {
  const { garantiaId } = useParams();
  const [garantia, setGarantia] = useState(null);
  const [reclamaciones, setReclamaciones] = useState(null);
  const [error, setError] = useState(null);
  const [nuevaDescripcion, setNuevaDescripcion] = useState('');
  const [abriendo, setAbriendo] = useState(false);

  function cargar() {
    api.garantia(garantiaId).then(setGarantia).catch((e) => setError(e.message));
    api.reclamacionesDeGarantia(garantiaId).then(setReclamaciones).catch((e) => setError(e.message));
  }

  useEffect(cargar, [garantiaId]);

  async function abrirReclamacion(e) {
    e.preventDefault();
    if (!nuevaDescripcion.trim()) return;
    setAbriendo(true);
    setError(null);
    try {
      await api.crearReclamacion(garantiaId, nuevaDescripcion.trim());
      setNuevaDescripcion('');
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setAbriendo(false);
    }
  }

  if (error && !garantia) return <p className="login-error">{error}</p>;
  if (!garantia) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Garantía — {garantia.equipo ? `${garantia.equipo.tipo_equipo} ${garantia.equipo.marca || ''} ${garantia.equipo.modelo || ''}`.trim() : 'Equipo'}</h1>
        {garantia.vigente === null ? <span className="pill pill--neutral">sin datos suficientes</span>
          : garantia.vigente ? <span className="pill pill--success">Vigente ({garantia.dias_restantes} días)</span>
          : <span className="pill pill--error">Vencida</span>}
      </div>

      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>Datos del equipo</h2>
        <dl className="crm-datos-lista">
          <dt>Tipo</dt><dd>{garantia.equipo?.tipo_equipo || '—'}</dd>
          <dt>Marca / Modelo</dt><dd>{garantia.equipo?.marca || '—'} {garantia.equipo?.modelo || ''}</dd>
          <dt>Número de serie</dt><dd>{garantia.equipo?.numero_serie || '—'}</dd>
          <dt>Fecha de instalación</dt><dd>{formatearFecha(garantia.equipo?.fecha_instalacion)}</dd>
          <dt>Proyecto</dt><dd>{garantia.equipo?.proyecto_id ? <Link to={`/proyectos/${garantia.equipo.proyecto_id}`}>Ver proyecto</Link> : '—'}</dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Garantía</h2>
        <dl className="crm-datos-lista">
          <dt>Fecha de inicio</dt><dd>{formatearFecha(garantia.fecha_inicio)}</dd>
          <dt>Meses de garantía</dt><dd>{garantia.meses_garantia ?? '—'}</dd>
          <dt>Vence</dt><dd>{formatearFecha(garantia.fecha_fin)}</dd>
          <dt>Proveedor</dt><dd>{garantia.proveedor || '—'}</dd>
          <dt>Notas</dt><dd>{garantia.notas || '—'}</dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Reclamaciones</h2>
        {reclamaciones === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : reclamaciones.length === 0 ? (
          <p className="operaciones-nota">Sin reclamaciones todavía.</p>
        ) : (
          <ul className="config-kb-lista">
            {reclamaciones.map((r) => <TarjetaReclamacion key={r.id} reclamacion={r} onCambio={cargar} />)}
          </ul>
        )}

        <h3>Abrir reclamación</h3>
        <form className="config-form-inline" onSubmit={abrirReclamacion}>
          <input type="text" placeholder="Describe el problema…" value={nuevaDescripcion} onChange={(e) => setNuevaDescripcion(e.target.value)} />
          <button type="submit" disabled={abriendo}>{abriendo ? 'Abriendo…' : 'Abrir reclamación'}</button>
        </form>
      </section>
    </div>
  );
}
