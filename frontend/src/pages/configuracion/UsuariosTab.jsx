import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const ROLES = ['administrador', 'supervisor', 'asesor'];

export default function UsuariosTab() {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '', rol: 'asesor' });
  const [linkGenerado, setLinkGenerado] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEdicion, setNombreEdicion] = useState('');

  function cargar() {
    api.usuariosConfig().then(setDatos).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function invitar(e) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.email.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      const invitacion = await api.invitarUsuario(form);
      setLinkGenerado(`${window.location.origin}${invitacion.link}`);
      setForm({ nombre: '', email: '', rol: 'asesor' });
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarRol(usuarioId, rol) {
    try {
      await api.actualizarMiembro(usuarioId, { rol });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(usuarioId, activo) {
    try {
      await api.actualizarMiembro(usuarioId, { activo: !activo });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  function empezarEdicionNombre(m) {
    setEditandoId(m.usuario_id);
    setNombreEdicion(m.usuarios?.nombre || '');
  }

  async function guardarNombre(e, usuarioId) {
    e.preventDefault();
    if (!nombreEdicion.trim()) return;
    try {
      await api.actualizarMiembro(usuarioId, { nombre: nombreEdicion.trim() });
      setEditandoId(null);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <h2>Agregar usuario</h2>
      <form className="config-form" onSubmit={invitar}>
        <label>Nombre
          <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        </label>
        <label>Correo
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>Rol
          <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button type="submit" disabled={enviando}>Enviar invitación</button>
      </form>

      {linkGenerado && (
        <div className="config-link-invitacion">
          <p>Invitación creada. Aún no enviamos correos automáticamente — copia este link y compártelo (WhatsApp, correo personal):</p>
          <code>{linkGenerado}</code>
        </div>
      )}

      {error && <p className="login-error">{error}</p>}
      {datos === null && <p className="operaciones-nota">Cargando…</p>}

      {datos && (
        <>
          <h2>Miembros</h2>
          <ul className="config-usuarios-lista">
            {datos.miembros.map((m) => (
              <li key={m.usuario_id} className="config-usuario-item">
                {editandoId === m.usuario_id ? (
                  <form className="config-usuario-form-nombre" onSubmit={(e) => guardarNombre(e, m.usuario_id)}>
                    <input value={nombreEdicion} onChange={(e) => setNombreEdicion(e.target.value)} autoFocus />
                    <button type="submit">Guardar</button>
                    <button type="button" onClick={() => setEditandoId(null)}>Cancelar</button>
                  </form>
                ) : (
                  <>
                    <span>{m.usuarios?.nombre || m.usuarios?.email}</span>
                    <button onClick={() => empezarEdicionNombre(m)}>Editar nombre</button>
                    <select value={m.rol} onChange={(e) => cambiarRol(m.usuario_id, e.target.value)}>
                      {['owner', ...ROLES].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button onClick={() => toggleActivo(m.usuario_id, m.activo)}>
                      {m.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {datos.invitacionesPendientes.length > 0 && (
            <>
              <h2>Invitaciones pendientes</h2>
              <ul className="config-usuarios-lista">
                {datos.invitacionesPendientes.map((inv) => (
                  <li key={inv.id} className="config-usuario-item">
                    <span>{inv.nombre} ({inv.email}) — {inv.rol}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
