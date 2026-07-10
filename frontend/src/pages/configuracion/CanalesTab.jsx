import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Fase 6, MVP: solo lectura + conectar Google Calendar. Dar de alta un
// número de WhatsApp nuevo es una operación de Twilio/facturación, fuera
// de autoservicio por ahora.
export default function CanalesTab() {
  const { sesion } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.canalesConfig().then(setDatos).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="login-error">{error}</p>;
  if (!datos) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <section className="crm-seccion">
        <h2>WhatsApp</h2>
        {datos.canales.length === 0 ? (
          <p className="operaciones-nota">Sin canales configurados.</p>
        ) : (
          <ul className="config-kb-lista">
            {datos.canales.map((c, i) => (
              <li key={i} className="config-kb-item">
                {c.endpoint} <span className={`etiqueta-atencion ${c.activo ? 'etiqueta-atencion--humano' : ''}`}>
                  {c.activo ? 'Activo' : 'Inactivo'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Google Calendar</h2>
        {datos.googleCalendar.conectado ? (
          <p className="operaciones-nota">Conectado ({datos.googleCalendar.proveedor}) — sincronización activa.</p>
        ) : (
          <>
            <p className="operaciones-nota">No conectado. La agenda de TARA funciona igual sin esta integración.</p>
            <a href={`/oauth/google/iniciar?company_id=${sesion?.empresaActiva?.company_id}`}>
              <button type="button">Conectar Google Calendar</button>
            </a>
          </>
        )}
      </section>
    </div>
  );
}
