import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import NuevaCitaModal from './agenda/NuevaCitaModal';
import AgendaViva from './agenda/AgendaViva';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatearHora(iso) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Motor de Agenda Universal (Fase 1): si la empresa tiene agenda_config
// configurado, se muestra AgendaViva (carriles, alertas, recomendaciones).
// Si no (Tienda Soccer, Total Racks, cualquier empresa futura sin migrar
// todavía), se muestra exactamente la vista clásica de Fase 4, sin cambios —
// decisión explícita de la dueña: esas dos operan por cotización/producción,
// no por citas de recursos-hora, y no deben forzarse a este modelo.
export default function Agenda() {
  const [agendaConfig, setAgendaConfig] = useState(undefined); // undefined = cargando, null = sin config

  useEffect(() => {
    api.agendaConfig().then(setAgendaConfig).catch(() => setAgendaConfig(null));
  }, []);

  if (agendaConfig === undefined) return <p className="operaciones-nota">Cargando…</p>;
  if (agendaConfig) return <AgendaViva />;
  return <AgendaClasica />;
}

// Fase 4: vista de agenda por día, agrupada por asesor (simplificación
// aprobada — sin calendario tipo grid). Un solo camino de escritura de citas:
// esta pantalla llama a las mismas rutas /api/agenda/* que reusan
// SchedulingEngine, el mismo motor que usa la conversación de WhatsApp.
function AgendaClasica() {
  const [fecha, setFecha] = useState(hoyISO());
  const [citas, setCitas] = useState(null);
  const [asesores, setAsesores] = useState([]);
  const [clientesExistentes, setClientesExistentes] = useState([]);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    api.asesores().then(setAsesores).catch(() => {});
    // Pivote a producto, Fase 4.4: antes usaba api.conversaciones() — CRM es
    // la fuente única de verdad de "cliente", Conversaciones no debería
    // serlo solo porque comparte una forma de datos similar.
    api.clientesCrm().then(setClientesExistentes).catch(() => {});
  }, []);

  useEffect(() => { cargarCitas(); }, [fecha]);

  function cargarCitas() {
    const desde = `${fecha}T00:00:00.000Z`;
    const hasta = `${fecha}T23:59:59.999Z`;
    api.citas(desde, hasta).then(setCitas).catch((e) => setError(e.message));
  }

  async function cancelar(citaId) {
    try {
      await api.cancelarCita(citaId);
      cargarCitas();
    } catch (e) {
      setError(e.message);
    }
  }

  const citasPorAsesor = {};
  (citas || []).forEach((c) => {
    const nombreAsesor = c.asesores?.nombre || 'Sin asignar';
    (citasPorAsesor[nombreAsesor] = citasPorAsesor[nombreAsesor] || []).push(c);
  });

  return (
    <div>
      <h1>Agenda</h1>

      <div className="agenda-controles">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <button onClick={() => setMostrarForm(true)}>Nueva cita</button>
      </div>

      {error && <p className="login-error">{error}</p>}
      {citas === null && <p className="operaciones-nota">Cargando…</p>}
      {citas?.length === 0 && <p className="operaciones-nota">Sin citas este día.</p>}

      {Object.entries(citasPorAsesor).map(([nombreAsesor, lista]) => (
        <div key={nombreAsesor} className="agenda-grupo-asesor">
          <h3>{nombreAsesor}</h3>
          <ul className="agenda-citas-lista">
            {lista.map((cita) => (
              <li key={cita.id} className="agenda-cita-item">
                <span>{formatearHora(cita.inicio)}–{formatearHora(cita.fin)}</span>
                <span><Link to={`/crm/clientes/${cita.cliente_id}`}>{cita.clientes?.nombre || cita.clientes?.telefono}</Link></span>
                <span className={`agenda-estado agenda-estado--${cita.estado}`}>{cita.estado}</span>
                {cita.estado !== 'cancelada' && (
                  <button onClick={() => cancelar(cita.id)}>Cancelar</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {mostrarForm && (
        <NuevaCitaModal
          asesores={asesores}
          clientesExistentes={clientesExistentes}
          fechaDefault={fecha}
          onCerrar={() => setMostrarForm(false)}
          onCreada={() => { setMostrarForm(false); cargarCitas(); }}
        />
      )}
    </div>
  );
}
