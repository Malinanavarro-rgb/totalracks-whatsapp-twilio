import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import LogoTara from '../components/LogoTara';

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

function IconoA() {
  return <LogoTara size={15} background={null} foreground="#fff" dot="#22c7b8" />;
}

// Categorías genéricas — mapean a las herramientas reales de Modo Operador
// (modules/operador-tools.js), no a una industria específica: catálogo/FAQ,
// CRM, tareas/decisiones y (solo gerencial) memoria del negocio. Las
// preguntas de ejemplo son solo un punto de partida — el cuadro de texto
// libre de arriba siempre acepta cualquier pregunta.
const CATEGORIAS = [
  {
    id: 'catalogo',
    etiqueta: 'Catálogo y fichas técnicas',
    preguntas: [
      '¿Qué productos tenemos disponibles?',
      '¿Cuáles son las fichas técnicas pendientes de confirmar?',
    ],
  },
  {
    id: 'faq',
    etiqueta: 'Preguntas frecuentes de clientes',
    preguntas: [
      '¿Cómo le explico a un cliente el proceso de instalación?',
      '¿Qué le respondo a un cliente que pregunta por garantías?',
    ],
  },
  {
    id: 'crm',
    etiqueta: 'Clientes y pipeline',
    preguntas: [
      '¿Qué oportunidades llevan más de 3 días sin seguimiento?',
      '¿Cuántos prospectos nuevos tengo esta semana?',
    ],
  },
  {
    id: 'tareas',
    etiqueta: 'Tareas y decisiones',
    preguntas: [
      '¿Qué tareas tengo abiertas esta semana?',
      '¿Qué decisiones importantes se tomaron recientemente?',
    ],
  },
  {
    id: 'memoria',
    etiqueta: 'Memoria del negocio',
    soloGerencial: true,
    preguntas: [
      'Dame el resumen ejecutivo del negocio.',
      '¿Qué aprendizajes están pendientes de confirmar?',
    ],
  },
];

// Fase 4 del Centro de Conocimiento: pantalla dedicada sobre el MISMO Modo
// Operador ya construido (server.js: /api/operador/preguntar y
// /api/operador/convertir-para-cliente) — sin backend nuevo, solo una
// interfaz con más espacio y categorías que en el cuadro embebido de
// Operaciones.jsx.
export default function CentroConocimiento() {
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const categorias = CATEGORIAS.filter((c) => !c.soloGerencial || esGerencial);

  const [categoriaActiva, setCategoriaActiva] = useState(categorias[0]?.id || null);
  const [preguntaInput, setPreguntaInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [historial, setHistorial] = useState([]); // [{ id, pregunta, respuesta, respuestaCliente, cargandoConversion }], más reciente primero — solo de esta sesión, no se persiste

  async function preguntar(texto) {
    const pregunta = texto.trim();
    if (!pregunta || cargando) return;
    const id = Date.now();
    setCargando(true);
    setPreguntaInput('');
    try {
      const resultado = await api.preguntarOperador(pregunta);
      setHistorial((prev) => [{ id, pregunta, respuesta: resultado.respuesta_texto, respuestaCliente: null, cargandoConversion: false }, ...prev]);
    } catch (e) {
      const respuesta = e.status === 403
        ? 'No tienes acceso a Modo Operador con tu rol actual.'
        : 'No pude responder en este momento — intenta de nuevo.';
      setHistorial((prev) => [{ id, pregunta, respuesta, respuestaCliente: null, cargandoConversion: false }, ...prev]);
    } finally {
      setCargando(false);
    }
  }

  async function convertirParaCliente(id, textoInterno) {
    setHistorial((prev) => prev.map((h) => (h.id === id ? { ...h, cargandoConversion: true } : h)));
    try {
      const resultado = await api.convertirParaCliente(textoInterno);
      setHistorial((prev) => prev.map((h) => (h.id === id ? { ...h, respuestaCliente: resultado.respuesta_cliente, cargandoConversion: false } : h)));
    } catch {
      setHistorial((prev) => prev.map((h) => (h.id === id ? { ...h, respuestaCliente: 'No pude generar la versión para cliente — intenta de nuevo.', cargandoConversion: false } : h)));
    }
  }

  function enviarPregunta(e) {
    e.preventDefault();
    preguntar(preguntaInput);
  }

  const categoria = categorias.find((c) => c.id === categoriaActiva);

  return (
    <div>
      <section className="tara-hero">
        <p className="tara-hero-tagline">Powered by TARA AI</p>
        <h1 className="tara-hero-saludo">Centro de Conocimiento</h1>
        <p className="tara-hero-encontre">
          <span className="tara-hero-pulso"></span>
          Pregúntale a TARA lo que necesites sobre tu empresa — catálogo, clientes, tareas y más.
        </p>
      </section>

      <div className="pregunta-tara-caja">
        <form className="pregunta-tara-input" onSubmit={enviarPregunta}>
          <input
            type="text" value={preguntaInput} placeholder="¿Qué quieres saber?"
            onChange={(e) => setPreguntaInput(e.target.value)}
          />
          <button type="submit" className="pregunta-tara-enviar" disabled={cargando}><IconoA /></button>
        </form>
      </div>

      <h2 className="alertas-titulo alertas-titulo--secundario">Categorías</h2>
      <div className="centro-conocimiento-categorias">
        {categorias.map((c) => (
          <button
            key={c.id} type="button"
            className={c.id === categoriaActiva ? 'pregunta-tara-chip pregunta-tara-chip--activo' : 'pregunta-tara-chip'}
            onClick={() => setCategoriaActiva(c.id)}
          >
            {c.etiqueta}
          </button>
        ))}
      </div>
      {categoria && (
        <div className="pregunta-tara-sugerencias">
          {categoria.preguntas.map((p) => (
            <button key={p} className="pregunta-tara-chip" onClick={() => preguntar(p)} disabled={cargando}>{p}</button>
          ))}
        </div>
      )}

      {cargando && <p className="operaciones-nota">TARA está pensando…</p>}

      {historial.length > 0 && (
        <>
          <h2 className="alertas-titulo alertas-titulo--secundario">Conversación</h2>
          <div className="centro-conocimiento-historial">
            {historial.map((h) => (
              <div key={h.id} className="centro-conocimiento-item">
                <p className="centro-conocimiento-pregunta">{h.pregunta}</p>
                <p className="pregunta-tara-respuesta">{h.respuesta}</p>
                <button
                  type="button" className="pregunta-tara-chip" disabled={h.cargandoConversion}
                  onClick={() => convertirParaCliente(h.id, h.respuesta)}
                >
                  {h.cargandoConversion ? 'Traduciendo…' : 'Convertir en respuesta para cliente'}
                </button>
                {h.respuestaCliente && (
                  <p className="pregunta-tara-respuesta pregunta-tara-respuesta--cliente">{h.respuestaCliente}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
