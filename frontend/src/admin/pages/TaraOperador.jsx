import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';

const PREGUNTAS_SUGERIDAS_PLATAFORMA = [
  '¿Qué tareas quedaron abiertas?',
  '¿Qué proyectos tienen más riesgo?',
  '¿Qué decisiones se registraron recientemente?',
  'Resume el estado del pipeline comercial.',
];
const PREGUNTAS_SUGERIDAS_EMPRESA = [
  '¿Qué clientes necesitan seguimiento?',
  '¿Qué tareas quedaron abiertas?',
  'Resume el pipeline comercial de esta empresa.',
  'Busca algo en su catálogo técnico o FAQ.',
];

// Modo Operador — Nivel 1 (TARA-OS). Sin empresa seleccionada: alcance
// 'plataforma' (ve todo el ecosistema, sin filtro). Con empresa seleccionada
// (TARA AI Consulta Empresarial, Fase 1, 2026-10-16): el company_id lo
// resuelve y valida el servidor (nunca el texto de la pregunta), y el
// catálogo de herramientas queda restringido a las 8 ya auditadas de solo
// lectura — ver server.js::POST /api/admin/operador/consultar-empresa.
export default function TaraOperador() {
  const [empresas, setEmpresas] = useState(null);
  const [empresaId, setEmpresaId] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.empresasConsultables().then(setEmpresas).catch(e => setError(e.message));
  }, []);

  // Cambiar de empresa SIEMPRE empieza una conversación nueva — nunca se
  // reusa el historial de la empresa anterior (pedido explícito de
  // aislamiento: "reutilización accidental del contexto de una
  // conversación anterior").
  function cambiarEmpresa(nuevoId) {
    setEmpresaId(nuevoId);
    setHistorial([]);
    setError(null);
  }

  async function preguntar(texto) {
    if (!texto.trim() || cargando) return;
    setCargando(true);
    setError(null);
    setHistorial(h => [...h, { rol: 'usuario', texto }]);
    setPregunta('');
    try {
      const resultado = empresaId
        ? await adminApi.preguntarOperadorEmpresa(empresaId, texto)
        : await adminApi.preguntarOperador(texto);
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

  const empresaActiva = empresas?.find(emp => emp.id === empresaId);
  const sugeridas = empresaId ? PREGUNTAS_SUGERIDAS_EMPRESA : PREGUNTAS_SUGERIDAS_PLATAFORMA;

  return (
    <div>
      <div className="pm-topline">
        <div>
          <h1>Pregúntale a TARA</h1>
          <p>{empresaActiva ? `Consultando únicamente: ${empresaActiva.nombre}` : 'Modo Operador — ve todo el ecosistema de organizaciones autorizadas'}</p>
        </div>
        <select value={empresaId} onChange={e => cambiarEmpresa(e.target.value)} disabled={cargando}>
          <option value="">Todo el ecosistema (plataforma)</option>
          {(empresas || []).map(emp => (
            <option key={emp.id} value={emp.id}>{emp.nombre}</option>
          ))}
        </select>
      </div>

      {error && <p className="pm-error">{error}</p>}

      <div className="pm-panel">
        <div className="pm-panel-body" style={{ padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {historial.length === 0 && (
            <p className="pm-nota">
              {empresaActiva
                ? `Pregunta algo sobre ${empresaActiva.nombre} — tareas, proyectos, clientes, pipeline, catálogo o FAQ.`
                : 'Pregunta algo sobre tus organizaciones — tareas, proyectos, decisiones, pipeline.'}
            </p>
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
            {sugeridas.map(p => (
              <button key={p} className="pm-btn" onClick={() => preguntar(p)} disabled={cargando}>{p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
