import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Fase Demo · Tienda Soccer → Fase Premium V1.1: "Catálogo" reutiliza el
// mismo backend de Servicios (modules/configuracion.js, tabla `servicios`)
// ya construido en el Pivote a producto — sin inventar SKU ni variantes
// que no existen todavía en el esquema. Solo cambia la presentación (tarjetas
// de producto en vez de lista + formulario) y se omite el campo
// "duración en minutos" del formulario porque no aplica a un producto físico
// — el backend ya le pone 30 por default si no se envía, sin cambios ahí.
export default function Catalogo() {
  const [productos, setProductos] = useState(null);
  const [form, setForm] = useState({ nombre: '', precio: '' });
  const [error, setError] = useState(null);

  function cargar() {
    api.serviciosConfig().then(setProductos).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearServicioConfig({
        nombre: form.nombre.trim(),
        precio: form.precio ? Number(form.precio) : null,
      });
      setForm({ nombre: '', precio: '' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(producto) {
    try {
      await api.actualizarServicioConfig(producto.id, { activo: !producto.activo });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarServicioConfig(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <h2 className="titulo-seccion">¿Qué vendo?</h2>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nombre del producto" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input type="number" min="0" placeholder="Precio (opcional)" value={form.precio}
          onChange={(e) => setForm({ ...form, precio: e.target.value })} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {productos === null && <p className="operaciones-nota">Cargando…</p>}
      {productos?.length === 0 && <p className="operaciones-nota">Sin productos todavía.</p>}

      <div className="catalogo-grid">
        {productos?.map((p) => (
          <div key={p.id} className="producto-tarjeta">
            <div className="producto-tarjeta-imagen">📦</div>
            <div className="producto-tarjeta-cuerpo">
              <p className="producto-tarjeta-nombre">{p.nombre}</p>
              <div className="producto-tarjeta-pie">
                <span className="producto-tarjeta-precio">{p.precio != null ? `$${Number(p.precio).toLocaleString('es-MX')}` : '—'}</span>
                <span className={p.activo ? 'producto-tarjeta-estado' : 'producto-tarjeta-estado producto-tarjeta-estado--inactivo'}>
                  {p.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="producto-tarjeta-acciones">
                <button onClick={() => toggleActivo(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => eliminar(p.id)}>Eliminar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
