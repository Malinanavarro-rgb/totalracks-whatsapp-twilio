import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Pivote a producto, Fase 2.3: vista de pipeline sobre las mismas
// oportunidades ya editables desde la ficha de cliente (Fase 2.1) y el
// mismo catálogo de etapas configurable (Fase 2.2, api.pipelineEtapas()) —
// arrastrar una tarjeta llama al mismo endpoint que ya usa el select de
// estado en CrmClienteDetalle.jsx.
export default function CrmPipeline() {
  const [etapas, setEtapas] = useState(null);
  const [oportunidades, setOportunidades] = useState(null);
  const [error, setError] = useState(null);

  function cargar() {
    Promise.all([api.pipelineEtapas(), api.oportunidades()])
      .then(([et, op]) => {
        setEtapas(et.filter((e) => e.activo).sort((a, b) => a.orden - b.orden));
        setOportunidades(op);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function moverA(oportunidadId, nuevoEstado) {
    try {
      await api.actualizarOportunidad(oportunidadId, { estado: nuevoEstado });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  function onDrop(e, nombreEtapa) {
    e.preventDefault();
    const oportunidadId = e.dataTransfer.getData('text/plain');
    if (oportunidadId) moverA(oportunidadId, nombreEtapa);
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!etapas || !oportunidades) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <p><Link to="/crm">&larr; Ventas</Link></p>
      <h1>Proceso comercial</h1>

      {etapas.length === 0 ? (
        <p className="operaciones-nota">
          Sin etapas configuradas. Ve a Configuración → Proceso comercial para crear las etapas de tu proceso de venta.
        </p>
      ) : (
        <div className="crm-pipeline-tablero">
          {etapas.map((et) => {
            const deEstaEtapa = oportunidades.filter((op) => (op.estado || 'Nuevo') === et.nombre);
            return (
              <div
                key={et.id}
                className="crm-pipeline-columna"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, et.nombre)}
              >
                <h2>{et.nombre} <span className="crm-pipeline-contador">{deEstaEtapa.length}</span></h2>
                {deEstaEtapa.map((op) => (
                  <div
                    key={op.id}
                    className="crm-pipeline-tarjeta"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', op.id)}
                  >
                    <Link to={`/crm/clientes/${op.cliente_id}`}>
                      {op.clientes?.nombre || op.clientes?.telefono || 'Cliente'}
                    </Link>
                    <p>{op.descripcion || op.tipo_rack || 'Sin descripción'}</p>
                    {op.presupuesto_estimado && <p className="crm-pipeline-presupuesto">${op.presupuesto_estimado}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
