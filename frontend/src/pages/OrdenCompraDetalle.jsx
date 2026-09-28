import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Mismo criterio que modules/permisos.js::esGerencial() en el backend —
// duplicado a propósito en frontend (patrón ya usado en ProyectoDetalle.jsx).
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

const SEVERIDAD_ESTADO = { recibida: 'success', confirmada: 'warning', enviada: 'warning', cancelada: 'error', borrador: 'neutral' };
const ETIQUETA_ESTADO = { borrador: 'Borrador', enviada: 'Enviada', confirmada: 'Confirmada', recibida: 'Recibida', cancelada: 'Cancelada' };
// 'recibida' se excluye a propósito — esa transición SOLO pasa por el botón
// "Marcar como recibida" (genera el movimiento de inventario real), nunca
// por este selector de etiqueta (ver actualizarEstadoOrdenCompra en el backend).
const ESTADOS_SELECCIONABLES = ['borrador', 'enviada', 'confirmada', 'cancelada'];

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

export default function OrdenCompraDetalle() {
  const { ordenId } = useParams();
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const [orden, setOrden] = useState(null);
  const [error, setError] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [recibiendo, setRecibiendo] = useState(false);

  function cargar() {
    api.ordenCompra(ordenId).then(setOrden).catch((e) => setError(e.message));
  }

  useEffect(cargar, [ordenId]);

  async function cambiarEstado(nuevoEstado) {
    setCambiandoEstado(true);
    setError(null);
    try {
      await api.actualizarEstadoOrdenCompra(ordenId, nuevoEstado);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function recibir() {
    if (!window.confirm('¿Confirmas que esta orden llegó completa? Esto generará la entrada de inventario real para cada ítem — no se puede deshacer desde aquí.')) return;
    setRecibiendo(true);
    setError(null);
    try {
      await api.recibirOrdenCompra(ordenId);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setRecibiendo(false);
    }
  }

  if (error && !orden) return <p className="login-error">{error}</p>;
  if (!orden) return <p className="operaciones-nota">Cargando…</p>;

  const yaRecibida = orden.estado === 'recibida';
  const cancelada = orden.estado === 'cancelada';

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Orden {orden.numero_orden}</h1>
        <span className={`pill pill--${SEVERIDAD_ESTADO[orden.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[orden.estado] || orden.estado}</span>
      </div>

      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>Datos generales</h2>
        <dl className="crm-datos-lista">
          <dt>Proveedor</dt><dd>{orden.proveedor_nombre || '—'}</dd>
          <dt>Sucursal destino</dt><dd>{orden.sucursal_nombre || '—'}</dd>
          <dt>Proyecto</dt><dd>{orden.proyecto_id ? <Link to={`/proyectos/${orden.proyecto_id}`}>Ver proyecto</Link> : '—'}</dd>
          <dt>Fecha solicitada</dt><dd>{formatearFecha(orden.fecha_solicitada)}</dd>
          <dt>Fecha esperada</dt><dd>{formatearFecha(orden.fecha_esperada)}</dd>
          <dt>Fecha recibida</dt><dd>{formatearFecha(orden.fecha_recibida)}</dd>
          <dt>Notas</dt><dd>{orden.notas || '—'}</dd>
          <dt>Total</dt><dd>{formatearMonto(orden.total)}</dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Ítems</h2>
        <table>
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>Recibido</th><th>Subtotal</th></tr></thead>
          <tbody>
            {orden.items.map((it) => (
              <tr key={it.id}>
                <td>{it.productos ? `${it.productos.marca || ''} ${it.productos.modelo || ''}`.trim() : '—'}</td>
                <td>{it.cantidad} {it.productos?.unidad || ''}</td>
                <td>{formatearMonto(it.costo_unitario)}</td>
                <td>{it.cantidad_recibida}</td>
                <td>{formatearMonto(Number(it.cantidad) * Number(it.costo_unitario || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {esGerencial && !yaRecibida && (
        <section className="crm-seccion">
          <h2>Acciones</h2>
          <div className="config-form-inline">
            {!cancelada && (
              <select onChange={(e) => e.target.value && cambiarEstado(e.target.value)} value="" disabled={cambiandoEstado}>
                <option value="">Cambiar estado…</option>
                {ESTADOS_SELECCIONABLES.filter((e) => e !== orden.estado).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
              </select>
            )}
            {!cancelada && (
              <button type="button" onClick={recibir} disabled={recibiendo}>
                {recibiendo ? 'Recibiendo…' : 'Marcar como recibida (genera entrada de inventario)'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
