import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Subfase 2G (Alina, 2026-09-25) — mismo criterio que modules/permisos.js::esGerencial()
// en el backend, duplicado a propósito en frontend (patrón ya usado en ProyectoDetalle.jsx).
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

const SEVERIDAD_ESTADO = { recibida: 'success', confirmada: 'warning', enviada: 'warning', cancelada: 'error', borrador: 'neutral' };
const ETIQUETA_ESTADO = { borrador: 'Borrador', enviada: 'Enviada', confirmada: 'Confirmada', recibida: 'Recibida', cancelada: 'Cancelada' };

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Formulario para agregar un proveedor nuevo sin salir de la pantalla — el
// selector de proveedor de la orden se queda vacío hasta que exista al
// menos uno (nunca se inventa un proveedor default).
function FormNuevoProveedor({ onCreado }) {
  const [nombre, setNombre] = useState('');
  const [contactoTelefono, setContactoTelefono] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const proveedor = await api.crearProveedor({ nombre: nombre.trim(), contactoTelefono: contactoTelefono.trim() || undefined });
      setNombre('');
      setContactoTelefono('');
      onCreado(proveedor);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="config-form-inline" onSubmit={enviar}>
      <input type="text" placeholder="Nombre del proveedor" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      <input type="text" placeholder="Teléfono (opcional)" value={contactoTelefono} onChange={(e) => setContactoTelefono(e.target.value)} />
      <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : '+ Agregar proveedor'}</button>
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

// Ítems de la orden nueva — arreglo de {productoId, cantidad, costoUnitario}
// editado en memoria hasta enviar; nunca toca el backend hasta el submit
// final (mismo criterio que NuevaCotizacion.jsx con sus líneas).
function FilaItem({ item, productos, onCambiar, onQuitar }) {
  const producto = productos.find((p) => p.id === item.productoId);
  return (
    <tr>
      <td>
        <select value={item.productoId} onChange={(e) => onCambiar({ ...item, productoId: e.target.value })} required>
          <option value="">— selecciona —</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.marca} {p.modelo} ({p.tipo})</option>)}
        </select>
      </td>
      <td><input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={(e) => onCambiar({ ...item, cantidad: e.target.value })} required style={{ width: '5rem' }} /></td>
      <td><input type="number" min="0" step="0.01" value={item.costoUnitario} onChange={(e) => onCambiar({ ...item, costoUnitario: e.target.value })} style={{ width: '7rem' }} /></td>
      <td>{producto?.unidad || '—'}</td>
      <td><button type="button" className="boton-enlace" onClick={onQuitar}>Quitar</button></td>
    </tr>
  );
}

function FormNuevaOrden({ proveedores, sucursales, productos, onCreada }) {
  const [proveedorId, setProveedorId] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [fechaEsperada, setFechaEsperada] = useState('');
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState([{ productoId: '', cantidad: '', costoUnitario: '' }]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function actualizarItem(i, item) {
    setItems(items.map((it, idx) => (idx === i ? item : it)));
  }

  async function enviar(e) {
    e.preventDefault();
    setError(null);
    const itemsValidos = items.filter((it) => it.productoId && Number(it.cantidad) > 0);
    if (itemsValidos.length === 0) { setError('Agrega al menos un ítem con producto y cantidad.'); return; }
    setGuardando(true);
    try {
      const orden = await api.crearOrdenCompra({
        proveedorId, sucursalId, fechaEsperada: fechaEsperada || undefined, notas: notas.trim() || undefined,
        items: itemsValidos.map((it) => ({ productoId: it.productoId, cantidad: Number(it.cantidad), costoUnitario: it.costoUnitario ? Number(it.costoUnitario) : undefined })),
      });
      setProveedorId(''); setSucursalId(''); setFechaEsperada(''); setNotas('');
      setItems([{ productoId: '', cantidad: '', costoUnitario: '' }]);
      onCreada(orden);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="config-form-inline">
        <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
          <option value="">— proveedor —</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} required>
          <option value="">— sucursal que recibe —</option>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input type="date" value={fechaEsperada} onChange={(e) => setFechaEsperada(e.target.value)} placeholder="Fecha esperada" />
        <input type="text" placeholder="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <table>
        <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>Unidad</th><th></th></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <FilaItem key={i} item={it} productos={productos} onCambiar={(item) => actualizarItem(i, item)} onQuitar={() => setItems(items.filter((_, idx) => idx !== i))} />
          ))}
        </tbody>
      </table>
      <button type="button" className="boton-enlace" onClick={() => setItems([...items, { productoId: '', cantidad: '', costoUnitario: '' }])}>+ Agregar ítem</button>

      {error && <p className="login-error">{error}</p>}
      <div>
        <button type="submit" disabled={guardando || proveedores.length === 0 || sucursales.length === 0}>
          {guardando ? 'Creando…' : 'Crear orden (borrador)'}
        </button>
      </div>
    </form>
  );
}

export default function Compras() {
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const [ordenes, setOrdenes] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [productos, setProductos] = useState([]);
  const [error, setError] = useState(null);
  const [mostrarFormOrden, setMostrarFormOrden] = useState(false);

  function cargar() {
    Promise.all([api.ordenesCompra(), api.proveedores(), api.sucursales(), api.productosActivos()])
      .then(([o, p, s, prod]) => { setOrdenes(o); setProveedores(p); setSucursales(s); setProductos(prod); })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  if (error) return <p className="login-error">{error}</p>;

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Compras</h1>
      </div>

      {ordenes === null ? (
        <p className="operaciones-nota">Cargando…</p>
      ) : (
        <>
          {esGerencial && (
            <section className="crm-seccion">
              <h2>Proveedores</h2>
              {proveedores.length === 0 && <p className="operaciones-nota">Sin proveedores registrados todavía — agrega el primero para poder crear una orden.</p>}
              <FormNuevoProveedor onCreado={(p) => setProveedores([...proveedores, p].sort((a, b) => a.nombre.localeCompare(b.nombre)))} />
            </section>
          )}

          {esGerencial && (
            <section className="crm-seccion">
              <div className="crm-seccion-header">
                <h2>Nueva orden de compra</h2>
                <button type="button" className="boton-enlace" onClick={() => setMostrarFormOrden(!mostrarFormOrden)}>
                  {mostrarFormOrden ? 'Cancelar' : '+ Nueva orden'}
                </button>
              </div>
              {mostrarFormOrden && (
                sucursales.length === 0 ? (
                  <p className="operaciones-nota">Esta empresa no tiene sucursales configuradas — no se puede crear una orden sin saber a dónde llega el material.</p>
                ) : (
                  <FormNuevaOrden
                    proveedores={proveedores} sucursales={sucursales} productos={productos}
                    onCreada={(orden) => { setOrdenes([orden, ...ordenes]); setMostrarFormOrden(false); }}
                  />
                )
              )}
            </section>
          )}

          <section className="crm-seccion">
            <h2>Órdenes de compra</h2>
            {ordenes.length === 0 ? (
              <p className="operaciones-nota">Todavía no hay órdenes de compra.</p>
            ) : (
              <table>
                <thead><tr><th>Folio</th><th>Proveedor</th><th>Sucursal</th><th>Fecha esperada</th><th>Total</th><th>Estado</th></tr></thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.id}>
                      <td><NavLink to={`/compras/${o.id}`}>{o.numero_orden}</NavLink></td>
                      <td>{o.proveedor_nombre || '—'}</td>
                      <td>{o.sucursal_nombre || '—'}</td>
                      <td>{formatearFecha(o.fecha_esperada)}</td>
                      <td>{formatearMonto(o.total)}</td>
                      <td><span className={`pill pill--${SEVERIDAD_ESTADO[o.estado] || 'neutral'}`}>{ETIQUETA_ESTADO[o.estado] || o.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
