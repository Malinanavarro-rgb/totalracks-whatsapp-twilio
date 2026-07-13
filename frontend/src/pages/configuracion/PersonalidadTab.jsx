import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Fase 6: solo campos de negocio. Los parámetros técnicos del motor de IA
// (modelo, temperatura, max_tokens, reglas, etc.) nunca se muestran aquí —
// el cliente nunca ve JSON ni conceptos técnicos (ADR-005). "Skills" es de
// negocio pero vive en su propia pestaña (SkillsTab.jsx, Fase 1.4).
export default function PersonalidadTab() {
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.personalidad().then(setForm).catch((e) => setError(e.message));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const actualizado = await api.actualizarPersonalidad(form);
      setForm(actualizado);
      setMensaje('Guardado — los cambios ya están activos.');
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  function campo(nombre, valor) {
    setForm({ ...form, [nombre]: valor });
  }

  if (error && !form) return <p className="login-error">{error}</p>;
  if (!form) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <form className="config-form" onSubmit={guardar}>
      <h2>Identidad del asistente</h2>
      <label>Nombre del asistente
        <input value={form.nombre_asistente || ''} onChange={(e) => campo('nombre_asistente', e.target.value)} />
      </label>
      <label>Cargo
        <input value={form.cargo || ''} onChange={(e) => campo('cargo', e.target.value)} />
      </label>
      <label>Objetivo
        <input value={form.objetivo || ''} onChange={(e) => campo('objetivo', e.target.value)} />
      </label>
      <label>Idioma
        <input value={form.idioma || ''} onChange={(e) => campo('idioma', e.target.value)} />
      </label>

      <h2>¿Cómo quieres que hable tu asistente?</h2>
      <div className="config-opciones">
        {['Muy formal', 'Profesional', 'Cercano', 'Divertido'].map((op) => (
          <label key={op} className="config-radio">
            <input
              type="radio" name="tono" checked={form.tono === op}
              onChange={() => campo('tono', op)}
            />
            {op}
          </label>
        ))}
      </div>

      <h2>Longitud de respuestas</h2>
      <div className="config-opciones">
        {[
          { valor: 'cortas', etiqueta: 'Cortas' },
          { valor: 'normales', etiqueta: 'Normales' },
          { valor: 'detalladas', etiqueta: 'Detalladas' },
        ].map((op) => (
          <label key={op.valor} className="config-radio">
            <input
              type="radio" name="longitud_respuesta" checked={form.longitud_respuesta === op.valor}
              onChange={() => campo('longitud_respuesta', op.valor)}
            />
            {op.etiqueta}
          </label>
        ))}
      </div>

      <h2>Uso de emojis</h2>
      <div className="config-opciones">
        {[
          { valor: 'nunca', etiqueta: 'Nunca' },
          { valor: 'moderado', etiqueta: 'Moderado' },
          { valor: 'frecuente', etiqueta: 'Frecuente' },
        ].map((op) => (
          <label key={op.valor} className="config-radio">
            <input
              type="radio" name="uso_emojis" checked={form.uso_emojis === op.valor}
              onChange={() => campo('uso_emojis', op.valor)}
            />
            {op.etiqueta}
          </label>
        ))}
      </div>

      <h2>Nivel de iniciativa</h2>
      <div className="config-opciones">
        {[
          { valor: 'solo_responder', etiqueta: 'Solo responder' },
          { valor: 'sugerir_productos', etiqueta: 'Sugerir productos' },
          { valor: 'cerrar_ventas', etiqueta: 'Cerrar ventas' },
        ].map((op) => (
          <label key={op.valor} className="config-radio">
            <input
              type="radio" name="nivel_iniciativa" checked={form.nivel_iniciativa === op.valor}
              onChange={() => campo('nivel_iniciativa', op.valor)}
            />
            {op.etiqueta}
          </label>
        ))}
      </div>

      <h2>Mensaje de bienvenida</h2>
      <label>Se envía solo la primera vez que un cliente escribe
        <textarea
          rows={2} value={form.mensaje_bienvenida || ''}
          onChange={(e) => campo('mensaje_bienvenida', e.target.value)}
        />
      </label>

      <h2>Firma</h2>
      <label>Se agrega al final de cada respuesta
        <input value={form.firma || ''} onChange={(e) => campo('firma', e.target.value)} />
      </label>

      <h2>Mensaje fuera de horario</h2>
      <label>Se envía cuando un cliente escribe fuera del horario de atención del bot
        <textarea
          rows={2} value={form.mensaje_fuera_horario || ''}
          onChange={(e) => campo('mensaje_fuera_horario', e.target.value)}
        />
      </label>

      <h2>Mensaje de error técnico</h2>
      <label>Se envía si ocurre un error inesperado al procesar un mensaje
        <textarea
          rows={2} value={form.mensaje_error_tecnico || ''}
          onChange={(e) => campo('mensaje_error_tecnico', e.target.value)}
        />
      </label>

      {mensaje && <p className="config-mensaje-exito">{mensaje}</p>}
      {error && <p className="login-error">{error}</p>}

      <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
  );
}
