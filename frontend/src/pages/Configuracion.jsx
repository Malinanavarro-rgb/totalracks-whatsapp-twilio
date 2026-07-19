import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PersonalidadTab from './configuracion/PersonalidadTab';
import SkillsTab from './configuracion/SkillsTab';
import KnowledgeBaseTab from './configuracion/KnowledgeBaseTab';
import UsuariosTab from './configuracion/UsuariosTab';
import HorariosTab from './configuracion/HorariosTab';
import ServiciosTab from './configuracion/ServiciosTab';
import AsesoresTab from './configuracion/AsesoresTab';
import PipelineTab from './configuracion/PipelineTab';
import CanalesTab from './configuracion/CanalesTab';
import WorkflowsTab from './configuracion/WorkflowsTab';
import SuscripcionTab from './configuracion/SuscripcionTab';

// Mismo set que `soloGerencial` en server.js (owner/administrador — SIN
// supervisor, a diferencia del ROLES_GERENCIALES más amplio que usan
// agenda.js/conversaciones.js/crm-ui.js). Debe calzar exacto con el
// middleware real de /api/billing/*, para no mostrar un tab que luego
// falla con 403.
const ROLES_CON_ACCESO_A_BILLING = ['owner', 'administrador'];

const TABS = [
  { id: 'personalidad',  etiqueta: 'Personalidad',    Componente: PersonalidadTab },
  { id: 'skills',        etiqueta: 'Skills',           Componente: SkillsTab },
  { id: 'conocimiento',  etiqueta: 'Knowledge Base',   Componente: KnowledgeBaseTab },
  { id: 'usuarios',      etiqueta: 'Usuarios',         Componente: UsuariosTab },
  { id: 'horarios',      etiqueta: 'Horarios',         Componente: HorariosTab },
  { id: 'servicios',     etiqueta: 'Servicios',        Componente: ServiciosTab },
  { id: 'asesores',      etiqueta: 'Equipo',           Componente: AsesoresTab },
  { id: 'pipeline',      etiqueta: 'Proceso comercial', Componente: PipelineTab },
  { id: 'canales',       etiqueta: 'Canales',          Componente: CanalesTab },
  { id: 'workflows',     etiqueta: 'Guion de atención', Componente: WorkflowsTab },
  // Única excepción consciente a "ningún tab se oculta por rol": este
  // expone precio/facturación de la empresa — el resto de Configuración no
  // muestra información financiera, así que no aplica la misma regla.
  { id: 'suscripcion',   etiqueta: 'Suscripción y Facturación', Componente: SuscripcionTab, soloGerencial: true },
];

export default function Configuracion() {
  const { sesion } = useAuth();
  const esGerencial = ROLES_CON_ACCESO_A_BILLING.includes(sesion?.empresaActiva?.rol);
  const tabsVisibles = TABS.filter((t) => !t.soloGerencial || esGerencial);

  const [tabActiva, setTabActiva] = useState('personalidad');
  const Activa = tabsVisibles.find((t) => t.id === tabActiva)?.Componente || tabsVisibles[0]?.Componente;

  return (
    <div>
      <h1>Configuración</h1>

      <div className="config-tabs">
        {tabsVisibles.map((t) => (
          <button
            key={t.id}
            className={t.id === tabActiva ? 'config-tab config-tab--activa' : 'config-tab'}
            onClick={() => setTabActiva(t.id)}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="config-contenido">
        {Activa && <Activa />}
      </div>
    </div>
  );
}
