import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Pivote a producto, Fase 3: administración de workflows/nodos sin escribir
// SQL a mano. Debe coincidir con modules/workflow-admin.js::INTENCIONES_VALIDAS
// (catálogo fijo que reconoce el prompt — ver modules/prompt-builder.js).
const INTENCIONES = ['interes_compra', 'solicitud_cotizacion', 'soporte', 'seguimiento', 'cancelar_flujo', 'consulta_general'];

export default function WorkflowsTab() {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ nombre: '', descripcion: '', trigger_value: INTENCIONES[0], prioridad: 10 });
  const [workflowAbierto, setWorkflowAbierto] = useState(null);

  function cargar() {
    api.workflows().then(setWorkflows).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearWorkflow({ ...form, prioridad: Number(form.prioridad) || 10 });
      setForm({ nombre: '', descripcion: '', trigger_value: INTENCIONES[0], prioridad: 10 });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(wf) {
    try {
      await api.actualizarWorkflow(wf.id, { activo: !wf.activo });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarWorkflow(id);
      if (workflowAbierto === id) setWorkflowAbierto(null);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <p className="operaciones-nota">
        Un guion de atención se activa cuando TARA detecta la intención elegida en el mensaje del cliente, y guía la conversación paso a paso por los pasos que definas abajo.
      </p>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nombre del guion de atención" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <select value={form.trigger_value} onChange={(e) => setForm({ ...form, trigger_value: e.target.value })}>
          {INTENCIONES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <input type="number" min="1" placeholder="Prioridad" value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {workflows === null && <p className="operaciones-nota">Cargando…</p>}
      {workflows?.length === 0 && <p className="operaciones-nota">Sin guiones de atención todavía.</p>}

      <ul className="config-kb-lista config-workflows-lista">
        {workflows?.map((wf) => (
          <li key={wf.id} className="config-workflow-item">
            <div>
              <strong>{wf.nombre}</strong> — se activa con &quot;{wf.trigger_value}&quot;, prioridad {wf.prioridad}
              <button onClick={() => toggleActivo(wf)}>{wf.activo ? 'Desactivar' : 'Activar'}</button>
              <button onClick={() => eliminar(wf.id)}>Eliminar</button>
              <button onClick={() => setWorkflowAbierto(workflowAbierto === wf.id ? null : wf.id)}>
                {workflowAbierto === wf.id ? 'Ocultar pasos' : 'Editar pasos'}
              </button>
            </div>
            {workflowAbierto === wf.id && <NodosEditor workflowId={wf.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodosEditor({ workflowId }) {
  const [nodos, setNodos] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ nombre: '', pregunta: '', campo: '', siguiente_nodo: '', es_inicio: false, es_fin: false, orden: 0 });

  function cargar() {
    api.nodosWorkflow(workflowId).then(setNodos).catch((e) => setError(e.message));
  }

  useEffect(cargar, [workflowId]);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearNodo(workflowId, { ...form, orden: Number(form.orden) || 0 });
      setForm({ nombre: '', pregunta: '', campo: '', siguiente_nodo: '', es_inicio: false, es_fin: false, orden: 0 });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarNodo(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div className="config-workflow-nodos">
      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="nombre_del_paso (slug)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input placeholder="Pregunta al cliente" value={form.pregunta} onChange={(e) => setForm({ ...form, pregunta: e.target.value })} />
        <input placeholder="Campo a capturar" value={form.campo} onChange={(e) => setForm({ ...form, campo: e.target.value })} />
        <input placeholder="Siguiente paso (nombre)" value={form.siguiente_nodo} onChange={(e) => setForm({ ...form, siguiente_nodo: e.target.value })} />
        <input type="number" min="0" placeholder="Orden" value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
        <label><input type="checkbox" checked={form.es_inicio} onChange={(e) => setForm({ ...form, es_inicio: e.target.checked })} /> Inicio</label>
        <label><input type="checkbox" checked={form.es_fin} onChange={(e) => setForm({ ...form, es_fin: e.target.checked })} /> Fin</label>
        <button type="submit">Agregar paso</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {nodos === null && <p className="operaciones-nota">Cargando pasos…</p>}
      {nodos?.length === 0 && <p className="operaciones-nota">Sin pasos todavía.</p>}

      <ul className="config-kb-lista">
        {nodos?.map((n) => (
          <li key={n.id} className="config-kb-item">
            <strong>{n.nombre}</strong>{n.es_inicio ? ' (inicio)' : ''}{n.es_fin ? ' (fin)' : ''} — {n.pregunta || 'sin pregunta'}
            {n.siguiente_nodo && ` → ${n.siguiente_nodo}`}
            <button onClick={() => eliminar(n.id)}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
