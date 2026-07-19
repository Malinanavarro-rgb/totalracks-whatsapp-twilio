import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const ESTADO_ETIQUETA = {
  trial: 'Periodo de prueba', active: 'Activa', past_due: 'Pago pendiente',
  suspended: 'Suspendida', cancelled: 'Cancelada', expired: 'Prueba vencida',
};
const ESTADO_PILL = {
  trial: 'pill--warning', active: 'pill--success', past_due: 'pill--warning',
  suspended: 'pill--error', cancelled: 'pill--neutral', expired: 'pill--neutral',
};

function formatearMoneda(centavos) {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
function formatearFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Fase Portal del Cliente: cada empresa ve su propio plan/factura/método de
// pago. Reusa las mismas funciones puras del backend que ya usa el Panel
// Maestro (obtenerSuscripcionVigente/obtenerMetodoPagoVigente/listarPagos)
// — este tab solo los expone en modo lectura (+ actualizar método de pago),
// nunca escribe suscripciones/pagos directo.
export default function SuscripcionTab() {
  const [suscripcion, setSuscripcion] = useState(null);
  const [metodoPago, setMetodoPago] = useState(null);
  const [pagos, setPagos] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [editandoMetodo, setEditandoMetodo] = useState(false);

  function cargar() {
    Promise.all([
      api.suscripcionBilling().catch(() => null),
      api.metodoPagoBilling().catch(() => null),
      api.pagosBilling().catch(() => []),
    ]).then(([s, m, p]) => { setSuscripcion(s); setMetodoPago(m); setPagos(p); });
  }

  useEffect(cargar, []);

  async function cambiarDePlan() {
    setError(null);
    try {
      const { url } = await api.checkoutSession({
        planId: null, // el flujo real de selección de plan se define cuando exista Stripe conectado
        urlExito: window.location.href, urlCancelacion: window.location.href,
      });
      window.location.href = url;
    } catch (e) {
      setError(e.status === 501 ? 'Cambiar de plan estará disponible en cuanto conectemos un proveedor de pagos.' : e.message);
    }
  }

  async function reintentarPago() {
    setError(null);
    try {
      await api.reintentarPago();
    } catch (e) {
      setError(e.status === 501 ? 'Reintentar pago estará disponible en cuanto conectemos un proveedor de pagos.' : e.message);
    }
  }

  if (suscripcion === null && !error) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      {error && <p className="login-error">{error}</p>}
      {mensaje && <p className="operaciones-nota">{mensaje}</p>}

      <section className="crm-seccion">
        <h2>Tu plan</h2>
        {suscripcion ? (
          <ul className="config-kb-lista">
            <li className="config-kb-item">
              <strong>{suscripcion.planes?.nombre}</strong>
              {suscripcion.planes?.precio_centavos != null && ` — ${formatearMoneda(suscripcion.planes.precio_centavos)}/mes`}
              {' '}<span className={`pill ${ESTADO_PILL[suscripcion.estado] || 'pill--neutral'}`}>{ESTADO_ETIQUETA[suscripcion.estado] || suscripcion.estado}</span>
            </li>
            <li className="config-kb-item">Próximo cobro: {formatearFecha(suscripcion.fecha_periodo_actual_fin)}</li>
            {suscripcion.estado === 'trial' && (
              <li className="config-kb-item">Tu periodo de prueba termina: {formatearFecha(suscripcion.fecha_prueba_fin)}</li>
            )}
            <li className="config-kb-item">Renovación automática: {suscripcion.cancelar_al_fin_periodo ? 'No — se cancelará al fin del periodo' : 'Sí'}</li>
          </ul>
        ) : (
          <p className="operaciones-nota">Todavía no tienes un plan asignado — contáctanos para activar tu suscripción.</p>
        )}
        <div className="config-form-inline">
          <button onClick={cambiarDePlan}>Cambiar de plan</button>
          {suscripcion?.estado === 'past_due' && <button onClick={reintentarPago}>Reintentar pago</button>}
        </div>
      </section>

      <section className="crm-seccion">
        <h2>Método de pago</h2>
        {metodoPago ? (
          <p className="operaciones-nota">
            {metodoPago.marca} terminación {metodoPago.ultimos4} — expira {metodoPago.fecha_expiracion}
          </p>
        ) : (
          <p className="operaciones-nota">Sin método de pago registrado.</p>
        )}
        {!editandoMetodo ? (
          <button onClick={() => setEditandoMetodo(true)}>Actualizar método de pago</button>
        ) : (
          <FormularioMetodoPago
            onCancelar={() => setEditandoMetodo(false)}
            onGuardado={() => { setEditandoMetodo(false); setMensaje('Método de pago actualizado.'); cargar(); }}
          />
        )}
      </section>

      <section className="crm-seccion">
        <h2>Historial de pagos</h2>
        {!pagos?.length && <p className="operaciones-nota">Sin pagos registrados todavía.</p>}
        {pagos?.length > 0 && (
          <ul className="config-kb-lista">
            {pagos.map((p) => (
              <li key={p.id} className="config-kb-item">
                {formatearFecha(p.fecha_emision)} — {formatearMoneda(p.total_centavos)}
                {' '}<span className={`pill ${p.estado === 'paid' ? 'pill--success' : 'pill--neutral'}`}>{p.estado}</span>
                {p.factura_pdf_url && <a href={p.factura_pdf_url} target="_blank" rel="noreferrer"> PDF</a>}
                {p.factura_xml_url && <a href={p.factura_xml_url} target="_blank" rel="noreferrer"> XML</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Cancelar suscripción</h2>
        <p className="operaciones-nota">Si necesitas cancelar tu cuenta, contáctanos directamente — todavía no ofrecemos cancelación automática.</p>
      </section>
    </div>
  );
}

function FormularioMetodoPago({ onCancelar, onGuardado }) {
  const [proveedor, setProveedor] = useState('stripe');
  const [token, setToken] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [marca, setMarca] = useState('');
  const [fechaExpiracion, setFechaExpiracion] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.actualizarMetodoPagoBilling({ proveedor, token, ultimos4, marca, fechaExpiracion });
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="config-form-inline" onSubmit={guardar}>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token del proveedor" required />
      <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Marca (Visa)" />
      <input value={ultimos4} onChange={(e) => setUltimos4(e.target.value)} placeholder="Últimos 4" maxLength={4} />
      <input value={fechaExpiracion} onChange={(e) => setFechaExpiracion(e.target.value)} placeholder="MM/YY" />
      {error && <p className="login-error">{error}</p>}
      <button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" onClick={onCancelar}>Cancelar</button>
    </form>
  );
}
