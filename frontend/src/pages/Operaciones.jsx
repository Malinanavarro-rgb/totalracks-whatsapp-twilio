import { useAuth } from '../context/AuthContext';

// Fase 1: placeholder — valida el flujo completo de auth. Las métricas
// reales del Centro de Operaciones son Fase 2 (ver docs/roadmap, FASE 5).
export default function Operaciones() {
  const { sesion } = useAuth();

  return (
    <div>
      <h1>Bienvenida, {sesion?.usuario?.nombre || sesion?.usuario?.email}</h1>
      <p>Empresa activa: <strong>{sesion?.empresaActiva?.nombre}</strong> ({sesion?.empresaActiva?.rol})</p>
      <p className="operaciones-nota">
        El Centro de Operaciones (métricas) se construye en la Fase 2 de la Plataforma SaaS.
      </p>
    </div>
  );
}
