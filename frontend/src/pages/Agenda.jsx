import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import NuevaCitaModal from './agenda/NuevaCitaModal';
import AgendaViva from './agenda/AgendaViva';
import AgendaResumenGrid from './agenda/AgendaResumenGrid';
import { hoyISO, rangoParaVista, desplazarFecha, etiquetaRango } from './agenda/rangoFechas';

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
  const [vista, setVista] = useState('dia'); // 'dia' | 'semana' | 'mes'
  const [fecha, setFecha] = useState(hoyISO());
  const [citas, setCitas] = useState(null);
  const [asesores, setAsesores] = useState([]);
  const [clientesExistentes, setClientesExistentes] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    api.asesores().then(setAsesores).catch(() => {});
    // Pivote a producto, Fase 4.4: antes usaba api.conversaciones() — CRM es
    // la fuente única de verdad de "cliente", Conversaciones no debería
    // serlo solo porque comparte una forma de datos similar.
    api.clientesCrm().then(setClientesExistentes).catch(() => {});
    // Fase 2: catálogo con precio real, para el selector de servicio del modal.
    api.serviciosConfig().then(setServicios).catch(() => {});
  }, []);

  useEffect(() => { cargarCitas(); }, [fecha, vista]);

  function cargarCitas() {
    const { desde, hasta } = rangoParaVista(vista, fecha);
    api.citas(desde, hasta).then(setCitas).catch((e) => setError(e.message));
  }

  function irADia(iso) {
    setFecha(iso);
    setVista('dia');
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
        <div className="agenda-vista-toggle">
          {['dia', 'semana', 'mes'].map((v) => (
            <button key={v} className={vista === v ? 'activo' : ''} onClick={() => setVista(v)}>
              {v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>

        {vista === 'dia' ? (
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        ) : (
          <div className="agenda-rango-nav">
            <button onClick={() => setFecha(desplazarFecha(vista, fecha, -1))}>‹</button>
            <span className="agenda-rango-etiqueta">{etiquetaRango(vista, fecha)}</span>
            <button onClick={() => setFecha(desplazarFecha(vista, fecha, 1))}>›</button>
            <button onClick={() => setFecha(hoyISO())}>Hoy</button>
          </div>
        )}

        <button onClick={() => setMostrarForm(true)}>Nueva cita</button>
      </div>

      {error && <p className="login-error">{error}</p>}
      {citas === null && <p className="operaciones-nota">Cargando…</p>}

      {vista !== 'dia' && citas !== null && (
        <AgendaResumenGrid vista={vista} fechaBase={fecha} citas={citas} fechaHoy={hoyISO()} tema="clasica" onSeleccionarDia={irADia} />
      )}

      {vista === 'dia' && citas?.length === 0 && <p className="operaciones-nota">Sin citas este día.</p>}

      {vista === 'dia' && Object.entries(citasPorAsesor).map(([nombreAsesor, lista]) => (
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
          servicios={servicios}
          fechaDefault={fecha}
          onCerrar={() => setMostrarForm(false)}
          onCreada={() => { setMostrarForm(false); cargarCitas(); }}
        />
      )}
    </div>
  );
}
