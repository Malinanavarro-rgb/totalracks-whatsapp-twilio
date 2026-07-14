import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Pivote a producto, Fase 1.4: `skills` deja de ser exclusivo de SQL (ver
// modules/configuracion.js) — cada empresa activa/desactiva las habilidades
// que su asistente puede mencionar que sabe realizar. Mismo campo que ya
// lee modules/context-builder.js:238-241 para armar el prompt — sin ningún
// cambio al motor de IA.
export default function SkillsTab() {
  const [skills, setSkills] = useState(null);
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function cargar() {
    api.personalidad().then((p) => setSkills(Array.isArray(p?.skills) ? p.skills : [])).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function guardar(listaNueva) {
    setGuardando(true);
    setError(null);
    try {
      const actualizado = await api.actualizarPersonalidad({ skills: listaNueva });
      setSkills(actualizado.skills || []);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  function agregar(e) {
    e.preventDefault();
    if (!nuevo.trim()) return;
    guardar([...(skills || []), { nombre: nuevo.trim(), activo: true }]);
    setNuevo('');
  }

  function toggleActivo(idx) {
    guardar(skills.map((s, i) => (i === idx ? { ...s, activo: s.activo === false } : s)));
  }

  function eliminar(idx) {
    guardar(skills.filter((_, i) => i !== idx));
  }

  if (error && !skills) return <p className="login-error">{error}</p>;
  if (!skills) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <p className="operaciones-nota">
        Habilidades que tu asistente puede mencionar que sabe realizar (ej. "agendar citas", "cotizar productos"). Actívalas o desactívalas según lo que tu negocio ofrezca.
      </p>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nueva habilidad" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button type="submit" disabled={guardando}>Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {skills.length === 0 && <p className="operaciones-nota">Sin habilidades configuradas todavía.</p>}

      <ul className="config-kb-lista">
        {skills.map((s, idx) => (
          <li key={idx} className="config-kb-item">
            <strong>{s.nombre}</strong>
            <button onClick={() => toggleActivo(idx)} disabled={guardando}>{s.activo === false ? 'Activar' : 'Desactivar'}</button>
            <button onClick={() => eliminar(idx)} disabled={guardando}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
