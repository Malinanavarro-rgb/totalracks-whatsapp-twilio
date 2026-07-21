import { useState } from 'react';
import { adminApi } from '../adminApi';

const PREGUNTAS_SUGERIDAS = [
  '¿Qué tareas quedaron abiertas?',
  '¿Qué proyectos tienen más riesgo?',
  '¿Qué decisiones se registraron recientemente?',
  'Resume el estado del pipeline comercial.',
];

// Modo Operador — Nivel 1 (TARA-OS). Mismo motor que el Nivel 3 del panel de
// tenant (modules/operador-engine.js) — aquí el alcance es 'plataforma': ve
// todo el ecosistema de organizaciones autorizadas, sin filtro de empresa.
export default function TaraOperador() {
  const [pregunta, setPregunta] = useState('');
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(false);

  async function preguntar(texto) {
    if (!texto.trim() || cargando) return;
    setCargando(true);
    setHistorial(h => [...h, { rol: 'usuario', texto }]);
    setPregunta('');
    try {
      const resultado = await adminApi.preguntarOperador(texto);
      setHistorial(h => [...h, { rol: 'tara', texto: resultado.respuesta_texto }]);
    } catch (e) {
      setHistorial(h => [...h, { rol: 'tara', texto: `No pude responder: ${e.message}` }]);
    } finally {
      setCargando(false);
    }
  }

  function enviar(e) {
    e.preventDefault();
    preguntar(pregunta);
  }

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Pregúntale a TARA</h1><p>Modo Operador — ve todo el ecosistema de organizaciones autorizadas</p></div>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-body" style={{ padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {historial.length === 0 && (
            <p className="pm-nota">Pregunta algo sobre tus organizaciones — tareas, proyectos, decisiones, pipeline.</p>
          )}

          {historial.map((m, i) => (
            <div key={i} style={{ alignSelf: m.rol === 'usuario' ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
              <p className={m.rol === 'usuario' ? 'pm-pill pm-pill--ok' : 'pm-nota'} style={{ whiteSpace: 'pre-wrap' }}>
                {m.texto}
              </p>
            </div>
          ))}

          {cargando && <p className="pm-nota">TARA está pensando…</p>}

          <form onSubmit={enviar} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input
              type="text" value={pregunta} placeholder="¿Qué quieres saber?"
              onChange={(e) => setPregunta(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="pm-btn pm-btn--primario" disabled={cargando}>Preguntar</button>
          </form>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {PREGUNTAS_SUGERIDAS.map(p => (
              <button key={p} className="pm-btn" onClick={() => preguntar(p)} disabled={cargando}>{p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
