import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Subfase 2F (Alina, 2026-09-25) — el backend ya existía; esta pantalla se
// agregó después (2026-09-28) para cerrar el único módulo del bloque
// operativo sin frontend propio. `disponible` nunca se guarda — siempre
// existencia_fisica - reservado, ya calculado por modules/inventario.js.
const TIPOS_MOVIMIENTO = ['entrada', 'salida', 'ajuste', 'devolucion'];
const ETIQUETA_MOVIMIENTO = { entrada: 'Entrada', salida: 'Salida', reserva: 'Reserva', liberacion: 'Liberación', ajuste: 'Ajuste', devolucion: 'Devolución' };
const SEVERIDAD_MOVIMIENTO = { entrada: 'success', devolucion: 'success', salida: 'error', reserva: 'warning', liberacion: 'neutral', ajuste: 'warning' };

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function FormMovimiento({ productos, sucursales, onRegistrado }) {
  const [tipo, setTipo] = useState('entrada');
  const [productoId, setProductoId] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    setError(null);
    if (!productoId || !sucursalId || !(Number(cantidad) > 0)) { setError('Selecciona producto, sucursal y una cantidad mayor a 0.'); return; }
    if (tipo === 'ajuste' && !motivo.trim()) { setError('Un ajuste necesita un motivo — nunca se corrige el inventario en silencio.'); return; }
    setGuardando(true);
    try {
      await api.registrarMovimientoInventario({ tipo, productoId, sucursalId, cantidad: Number(cantidad), motivo: motivo.trim() || undefined, referencia: referencia.trim() || undefined });
      setCantidad(''); setMotivo(''); setReferencia('');
      onRegistrado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="config-form-inline">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{ETIQUETA_MOVIMIENTO[t]}</option>)}
        </select>
        <select value={productoId} onChange={(e) => setProductoId(e.target.value)} required>
          <option value="">— producto —</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.marca} {p.modelo} ({p.tipo})</option>)}
        </select>
        <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} required>
          <option value="">— sucursal —</option>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input type="number" min="0.001" step="0.001" placeholder="Cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required style={{ width: '6rem' }} />
        <input type="text" placeholder="Referencia (opcional)" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
      </div>
      {tipo === 'ajuste' && (
        <div className="config-form-inline">
          <input type="text" placeholder="Motivo del ajuste (requerido)" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        </div>
      )}
      {error && <p className="login-error">{error}</p>}
      <button type="submit" disabled={guardando}>{guardando ? 'Registrando…' : 'Registrar movimiento'}</button>
    </form>
  );
}

export default function Inventario() {
  const [saldos, setSaldos] = useState(null);
  const [movimientos, setMovimientos] = useState(null);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [error, setError] = useState(null);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');

  function cargarSaldos() {
    api.saldosInventario({ sucursalId: filtroSucursal, tipoProducto: filtroTipo }).then(setSaldos).catch((e) => setError(e.message));
  }

  useEffect(cargarSaldos, [filtroSucursal, filtroTipo]);
  useEffect(() => { api.movimientosInventario().then(setMovimientos).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    api.productosActivos().then(setProductos).catch(() => {});
    api.sucursales().then(setSucursales).catch(() => {});
  }, []);

  function recargarTodo() {
    cargarSaldos();
    api.movimientosInventario().then(setMovimientos).catch(() => {});
  }

  const sucursalPorId = Object.fromEntries(sucursales.map((s) => [s.id, s.nombre]));
  const productoPorId = Object.fromEntries(productos.map((p) => [p.id, p]));
  const tiposDisponibles = [...new Set(productos.map((p) => p.tipo))];

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Inventario</h1>
      </div>

      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>Existencias</h2>
        <div className="config-form-inline">
          <select value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {tiposDisponibles.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {saldos === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : saldos.length === 0 ? (
          <p className="operaciones-nota">Sin existencias registradas todavía.</p>
        ) : (
          <table>
            <thead><tr><th>Producto</th><th>Sucursal</th><th>Existencia física</th><th>Reservado</th><th>Disponible</th></tr></thead>
            <tbody>
              {saldos.map((s) => (
                <tr key={s.id}>
                  <td>{s.productos ? `${s.productos.marca || ''} ${s.productos.modelo || ''}`.trim() : '—'} <span className="operaciones-nota">({s.productos?.tipo})</span></td>
                  <td>{sucursalPorId[s.sucursal_id] || '—'}</td>
                  <td>{s.existencia_fisica} {s.productos?.unidad}</td>
                  <td>{s.reservado} {s.productos?.unidad}</td>
                  <td><strong>{s.disponible}</strong> {s.productos?.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Registrar movimiento</h2>
        <p className="operaciones-nota">Entrada/salida/devolución manuales — reserva/liberación de material para una instalación se registran automáticamente desde el proyecto.</p>
        <FormMovimiento productos={productos} sucursales={sucursales} onRegistrado={recargarTodo} />
      </section>

      <section className="crm-seccion">
        <h2>Movimientos recientes</h2>
        {movimientos === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : movimientos.length === 0 ? (
          <p className="operaciones-nota">Sin movimientos todavía.</p>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Sucursal</th><th>Cantidad</th><th>Motivo / Referencia</th></tr></thead>
            <tbody>
              {movimientos.slice(0, 50).map((m) => (
                <tr key={m.id}>
                  <td>{formatearFechaHora(m.created_at)}</td>
                  <td><span className={`pill pill--${SEVERIDAD_MOVIMIENTO[m.tipo] || 'neutral'}`}>{ETIQUETA_MOVIMIENTO[m.tipo] || m.tipo}</span></td>
                  <td>{productoPorId[m.producto_id] ? `${productoPorId[m.producto_id].marca || ''} ${productoPorId[m.producto_id].modelo || ''}`.trim() : '—'}</td>
                  <td>{sucursalPorId[m.sucursal_id] || '—'}</td>
                  <td>{m.cantidad}</td>
                  <td>{m.motivo || m.referencia || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
