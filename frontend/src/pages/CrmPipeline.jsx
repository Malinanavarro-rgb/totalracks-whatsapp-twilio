import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Pivote a producto, Fase 2.3: vista de pipeline sobre las mismas
// oportunidades ya editables desde la ficha de cliente (Fase 2.1) y el
// mismo catálogo de etapas configurable (Fase 2.2, api.pipelineEtapas()) —
// arrastrar una tarjeta llama al mismo endpoint que ya usa el select de
// estado en CrmClienteDetalle.jsx.
// Quick win (auditoría 2026-09-16, sección N.2) — razon_cierre ya existía en
// DB y en la whitelist del backend, solo faltaba pedirla desde la UI.
const RAZONES_PERDIDA = ['Precio', 'Competencia', 'No responde', 'Sin presupuesto', 'No califica', 'Proyecto pospuesto', 'No autorizado', 'Otro'];

export default function CrmPipeline() {
  const [etapas, setEtapas] = useState(null);
  const [oportunidades, setOportunidades] = useState(null);
  const [error, setError] = useState(null);
  const [pidiendoRazonPerdida, setPidiendoRazonPerdida] = useState(null); // oportunidadId o null
  const [razonPerdida, setRazonPerdida] = useState('');

  function cargar() {
    Promise.all([api.pipelineEtapas(), api.oportunidades()])
      .then(([et, op]) => {
        setEtapas(et.filter((e) => e.activo).sort((a, b) => a.orden - b.orden));
        setOportunidades(op);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function moverA(oportunidadId, nuevoEstado, razon_cierre) {
    try {
      await api.actualizarOportunidad(oportunidadId, razon_cierre !== undefined ? { estado: nuevoEstado, razon_cierre } : { estado: nuevoEstado });
      setPidiendoRazonPerdida(null);
      setRazonPerdida('');
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  function intentarMover(oportunidadId, nuevoEstado) {
    if (nuevoEstado === 'Perdido') {
      setPidiendoRazonPerdida(oportunidadId);
      setRazonPerdida('');
      return;
    }
    moverA(oportunidadId, nuevoEstado);
  }

  function onDrop(e, nombreEtapa) {
    e.preventDefault();
    const oportunidadId = e.dataTransfer.getData('text/plain');
    if (oportunidadId) intentarMover(oportunidadId, nombreEtapa);
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!etapas || !oportunidades) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <p><Link to="/crm">&larr; Volver</Link></p>
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
                <h2 className="crm-pipeline-columna-titulo">
                  {et.nombre} <span className="crm-pipeline-contador">{deEstaEtapa.length}</span>
                </h2>

                {deEstaEtapa.length === 0 && <p className="crm-pipeline-vacio">Sin oportunidades</p>}

                {deEstaEtapa.map((op) => (
                  <div
                    key={op.id}
                    className="crm-pipeline-tarjeta"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', op.id)}
                  >
                    <Link to={`/crm/clientes/${op.cliente_id}`} className="crm-pipeline-tarjeta-nombre">
                      {op.clientes?.nombre || op.clientes?.telefono || 'Cliente'}
                    </Link>
                    <p className="crm-pipeline-tarjeta-detalle">{op.descripcion || op.tipo_rack || 'Sin descripción'}</p>
                    <div className="crm-pipeline-tarjeta-pie">
                      {op.presupuesto_estimado
                        ? <span className="crm-pipeline-presupuesto">${Number(op.presupuesto_estimado).toLocaleString('es-MX')}</span>
                        : <span />}
                      <select
                        className="crm-pipeline-mover"
                        value={et.nombre}
                        onChange={(e) => intentarMover(op.id, e.target.value)}
                        aria-label="Mover a otra etapa"
                      >
                        {etapas.map((destino) => <option key={destino.id} value={destino.nombre}>{destino.nombre}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {pidiendoRazonPerdida && (
        <div className="modal-fondo">
          <div className="modal-tarjeta">
            <h2>¿Por qué se perdió esta oportunidad?</h2>
            <select value={razonPerdida} onChange={(e) => setRazonPerdida(e.target.value)}>
              <option value="">Selecciona un motivo…</option>
              {RAZONES_PERDIDA.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="modal-acciones">
              <button type="button" onClick={() => setPidiendoRazonPerdida(null)}>Cancelar</button>
              <button type="submit" disabled={!razonPerdida} onClick={() => moverA(pidiendoRazonPerdida, 'Perdido', razonPerdida)}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
