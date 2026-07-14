import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

// Fase Demo · Tienda Soccer → Fase Premium V1.1: "Catálogo" reutiliza el
// mismo backend de Servicios (modules/configuracion.js, tabla `servicios`)
// ya construido en el Pivote a producto — sin inventar datos que no
// existen. El ícono y el código de producto se calculan a partir del
// nombre real (presentación, no un campo nuevo en la base de datos); las
// tallas mostradas son el estándar de la industria (S/M/L/XL), no
// inventario por talla — eso sí requeriría un campo nuevo si se pide después.
const ICONO_POR_PALABRA_UNIFORMES = [
  [/f[uú]tbol/i, '⚽'], [/b[aá]squet/i, '🏀'], [/ciclis/i, '🚴'],
  [/b[eé]isbol/i, '⚾'], [/voleibol/i, '🏐'], [/handball/i, '🤾'],
];

// Fase Premium · Salón de Belleza: mismos "productos", giro distinto — un
// servicio no tiene talla, tiene duración (ver duracionServicio abajo).
const ICONO_POR_PALABRA_SALON = [
  [/pedicure/i, '🦶'], [/manicure/i, '💅'], [/ac[rí]lic/i, '💅'],
  [/gel/i, '💅'], [/spa|masaje/i, '💆'], [/ceja|pesta/i, '👁️'],
];

function iconoProducto(nombre, esSalonBelleza) {
  const tabla = esSalonBelleza ? ICONO_POR_PALABRA_SALON : ICONO_POR_PALABRA_UNIFORMES;
  const match = tabla.find(([re]) => re.test(nombre || ''));
  return match ? match[1] : (esSalonBelleza ? '✨' : '👕');
}

function duracionServicio(minutos) {
  if (!minutos) return null;
  return minutos >= 60 ? `${(minutos / 60).toString().replace('.0', '')} h` : `${minutos} min`;
}

function codigoProducto(nombre, id) {
  const palabra = (nombre || '').trim().split(/\s+/).pop() || 'PRD';
  const prefijo = palabra.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3).toUpperCase();
  return `${prefijo}-${String(id).slice(0, 4).padStart(4, '0')}`;
}

const TALLAS_ESTANDAR = ['S', 'M', 'L', 'XL'];

export default function Catalogo() {
  const { sesion } = useAuth();
  const esSalonBelleza = sesion?.empresaActiva?.industria_slug === 'salon_belleza';
  const [productos, setProductos] = useState(null);
  const [form, setForm] = useState({ nombre: '', precio: '', duracion_minutos: '' });
  const [error, setError] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicion, setFormEdicion] = useState({ nombre: '', precio: '', duracion_minutos: '' });

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
        duracion_minutos: form.duracion_minutos ? Number(form.duracion_minutos) : undefined,
      });
      setForm({ nombre: '', precio: '', duracion_minutos: '' });
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

  function empezarEdicion(producto) {
    setEditandoId(producto.id);
    setFormEdicion({ nombre: producto.nombre, precio: producto.precio ?? '', duracion_minutos: producto.duracion_minutos ?? '' });
  }

  async function guardarEdicion(e, id) {
    e.preventDefault();
    if (!formEdicion.nombre.trim()) return;
    try {
      await api.actualizarServicioConfig(id, {
        nombre: formEdicion.nombre.trim(),
        precio: formEdicion.precio !== '' ? Number(formEdicion.precio) : null,
        ...(esSalonBelleza ? { duracion_minutos: formEdicion.duracion_minutos !== '' ? Number(formEdicion.duracion_minutos) : null } : {}),
      });
      setEditandoId(null);
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
        {esSalonBelleza && (
          <input type="number" min="0" placeholder="Duración en minutos" value={form.duracion_minutos}
            onChange={(e) => setForm({ ...form, duracion_minutos: e.target.value })} />
        )}
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {productos === null && <p className="operaciones-nota">Cargando…</p>}
      {productos?.length === 0 && <p className="operaciones-nota">Sin productos todavía.</p>}

      <div className="catalogo-grid">
        {productos?.map((p) => (
          <div key={p.id} className="producto-tarjeta">
            <div className="producto-tarjeta-imagen">{iconoProducto(p.nombre, esSalonBelleza)}</div>
            <div className="producto-tarjeta-cuerpo">
              {editandoId === p.id ? (
                <form className="producto-tarjeta-form-edicion" onSubmit={(e) => guardarEdicion(e, p.id)}>
                  <input
                    value={formEdicion.nombre}
                    onChange={(e) => setFormEdicion({ ...formEdicion, nombre: e.target.value })}
                    placeholder="Nombre del producto"
                  />
                  <input
                    type="number" min="0" placeholder="Precio"
                    value={formEdicion.precio}
                    onChange={(e) => setFormEdicion({ ...formEdicion, precio: e.target.value })}
                  />
                  {esSalonBelleza && (
                    <input
                      type="number" min="0" placeholder="Duración en minutos"
                      value={formEdicion.duracion_minutos}
                      onChange={(e) => setFormEdicion({ ...formEdicion, duracion_minutos: e.target.value })}
                    />
                  )}
                  <div className="producto-tarjeta-acciones">
                    <button type="submit">Guardar</button>
                    <button type="button" onClick={() => setEditandoId(null)}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="producto-tarjeta-nombre">{p.nombre}</p>
                  <p className="producto-tarjeta-sku">SKU {codigoProducto(p.nombre, p.id)}</p>
                  <div className="producto-tarjeta-variantes">
                    {esSalonBelleza
                      ? (duracionServicio(p.duracion_minutos) && (
                          <span className="producto-tarjeta-variante">{duracionServicio(p.duracion_minutos)}</span>
                        ))
                      : TALLAS_ESTANDAR.map((t) => <span key={t} className="producto-tarjeta-variante">{t}</span>)
                    }
                  </div>
                  <div className="producto-tarjeta-pie">
                    <span className="producto-tarjeta-precio">{p.precio != null ? `$${Number(p.precio).toLocaleString('es-MX')}` : '—'}</span>
                    <span className={p.activo ? 'producto-tarjeta-estado' : 'producto-tarjeta-estado producto-tarjeta-estado--inactivo'}>
                      {p.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="producto-tarjeta-acciones">
                    <button onClick={() => empezarEdicion(p)}>Editar</button>
                    <button onClick={() => toggleActivo(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                    <button onClick={() => eliminar(p.id)}>Eliminar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
