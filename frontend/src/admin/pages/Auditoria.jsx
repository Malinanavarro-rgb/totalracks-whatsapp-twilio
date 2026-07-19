import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';

export default function Auditoria() {
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.auditLog().then(setEventos).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="pm-error">No se pudo cargar la auditoría: {error}</p>;
  if (!eventos) return <p className="pm-nota">Cargando…</p>;

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Auditoría</h1><p>Todo lo que un Super Admin hace, queda aquí</p></div>
      </div>

      <div className="pm-panel">
        <div className="pm-panel-body">
          {eventos.length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin eventos todavía.</p>}
          {eventos.map(e => (
            <div className="pm-audit-fila" key={e.id}>
              <span className="pm-audit-dot" />
              <span>{e.accion.replaceAll('_', ' ')}</span>
              <span className="pm-cuando">{new Date(e.created_at).toLocaleString('es-MX')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
