import { useState } from 'react';
import PersonalidadTab from './configuracion/PersonalidadTab';
import KnowledgeBaseTab from './configuracion/KnowledgeBaseTab';
import UsuariosTab from './configuracion/UsuariosTab';
import HorariosTab from './configuracion/HorariosTab';
import ServiciosTab from './configuracion/ServiciosTab';
import CanalesTab from './configuracion/CanalesTab';

const TABS = [
  { id: 'personalidad',  etiqueta: 'Personalidad',    Componente: PersonalidadTab },
  { id: 'conocimiento',  etiqueta: 'Knowledge Base',   Componente: KnowledgeBaseTab },
  { id: 'usuarios',      etiqueta: 'Usuarios',         Componente: UsuariosTab },
  { id: 'horarios',      etiqueta: 'Horarios',         Componente: HorariosTab },
  { id: 'servicios',     etiqueta: 'Servicios',        Componente: ServiciosTab },
  { id: 'canales',       etiqueta: 'Canales',          Componente: CanalesTab },
];

export default function Configuracion() {
  const [tabActiva, setTabActiva] = useState('personalidad');
  const Activa = TABS.find((t) => t.id === tabActiva)?.Componente;

  return (
    <div>
      <h1>Configuración</h1>

      <div className="config-tabs">
        {TABS.map((t) => (
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
