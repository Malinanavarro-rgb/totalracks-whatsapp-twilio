import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function ServiciosTab() {
  const [servicios, setServicios] = useState(null);
  const [form, setForm] = useState({ nombre: '', duracion_minutos: 30, precio: '' });
  const [error, setError] = useState(null);

  function cargar() {
    api.serviciosConfig().then(setServicios).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearServicioConfig({
        nombre: form.nombre.trim(),
        duracion_minutos: Number(form.duracion_minutos) || 30,
        precio: form.precio ? Number(form.precio) : null,
      });
      setForm({ nombre: '', duracion_minutos: 30, precio: '' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(servicio) {
    try {
      await api.actualizarServicioConfig(servicio.id, { activo: !servicio.activo });
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
      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nombre del servicio" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input type="number" min="5" step="5" placeholder="Minutos" value={form.duracion_minutos}
          onChange={(e) => setForm({ ...form, duracion_minutos: e.target.value })} />
        <input type="number" min="0" placeholder="Precio (opcional)" value={form.precio}
          onChange={(e) => setForm({ ...form, precio: e.target.value })} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {servicios === null && <p className="operaciones-nota">Cargando…</p>}
      {servicios?.length === 0 && <p className="operaciones-nota">Sin servicios todavía.</p>}

      <ul className="config-kb-lista">
        {servicios?.map((s) => (
          <li key={s.id} className="config-kb-item">
            <strong>{s.nombre}</strong> — {s.duracion_minutos} min{s.precio ? ` — $${s.precio}` : ''}
            <button onClick={() => toggleActivo(s)}>{s.activo ? 'Desactivar' : 'Activar'}</button>
            <button onClick={() => eliminar(s.id)}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
