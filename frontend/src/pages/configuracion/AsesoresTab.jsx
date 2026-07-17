import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Gestión del equipo (asesores/técnicas) desde el panel — antes solo se
// podían crear por script/SQL directo. Mismo patrón que ServiciosTab.jsx.
export default function AsesoresTab() {
  const [asesores, setAsesores] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '' });
  const [error, setError] = useState(null);

  function cargar() {
    api.asesoresConfig().then(setAsesores).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearAsesorConfig({ nombre: form.nombre.trim(), email: form.email.trim() || undefined });
      setForm({ nombre: '', email: '' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(asesor) {
    try {
      await api.actualizarAsesorConfig(asesor.id, { activo: !asesor.activo });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarAsesorConfig(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <p className="operaciones-nota">
        El equipo que aparece aquí es el mismo que se muestra en la Agenda — cada técnica/asesor con horario propio o el horario general de la empresa.
      </p>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input placeholder="Correo (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {asesores === null && <p className="operaciones-nota">Cargando…</p>}
      {asesores?.length === 0 && <p className="operaciones-nota">Sin equipo todavía.</p>}

      <ul className="config-kb-lista">
        {asesores?.map((a) => (
          <li key={a.id} className="config-kb-item">
            <strong>{a.nombre}</strong>{a.email ? ` — ${a.email}` : ''}{!a.activo ? ' (inactiva)' : ''}
            <button onClick={() => toggleActivo(a)}>{a.activo ? 'Desactivar' : 'Activar'}</button>
            <button onClick={() => eliminar(a.id)}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
