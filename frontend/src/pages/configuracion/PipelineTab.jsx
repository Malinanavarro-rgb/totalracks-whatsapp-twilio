import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Pivote a producto, Fase 2.2: catálogo de etapas de oportunidades por
// empresa — reemplaza el arreglo ESTADOS que antes estaba hardcodeado en
// CrmClienteDetalle.jsx (mezclado con estado de cliente).
export default function PipelineTab() {
  const [etapas, setEtapas] = useState(null);
  const [form, setForm] = useState({ nombre: '', orden: 0 });
  const [error, setError] = useState(null);

  function cargar() {
    api.pipelineEtapas().then(setEtapas).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    try {
      await api.crearPipelineEtapa({ nombre: form.nombre.trim(), orden: Number(form.orden) || 0 });
      setForm({ nombre: '', orden: 0 });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function toggleActivo(etapa) {
    try {
      await api.actualizarPipelineEtapa(etapa.id, { activo: !etapa.activo });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarPipelineEtapa(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <p className="operaciones-nota">Etapas por las que pasa una oportunidad de venta (ej. Nuevo, Negociación, Ganado). El orden controla cómo se muestran en el proceso comercial.</p>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Nombre de la etapa" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input type="number" min="0" placeholder="Orden" value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {etapas === null && <p className="operaciones-nota">Cargando…</p>}
      {etapas?.length === 0 && <p className="operaciones-nota">Sin etapas todavía.</p>}

      <ul className="config-kb-lista">
        {etapas?.map((et) => (
          <li key={et.id} className="config-kb-item">
            <strong>{et.nombre}</strong> — orden {et.orden}
            <button onClick={() => toggleActivo(et)}>{et.activo ? 'Desactivar' : 'Activar'}</button>
            <button onClick={() => eliminar(et.id)}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
