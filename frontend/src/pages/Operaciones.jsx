import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

// Fase 2: Centro de Operaciones real. Sin lógica de negocio aquí — solo
// pide /api/dashboard y pinta lo que regresa el backend (modules/dashboard.js).
export default function Operaciones() {
  const { sesion } = useAuth();
  const [metricas, setMetricas] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    api.dashboard()
      .then((datos) => { if (activo) setMetricas(datos); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  return (
    <div>
      <h1>Centro de Operaciones</h1>
      <p className="operaciones-nota">
        {sesion?.empresaActiva?.nombre} — vista general de la operación de hoy
      </p>

      {cargando && <p className="operaciones-nota">Cargando métricas…</p>}
      {error && <p className="login-error">No se pudieron cargar las métricas: {error}</p>}

      {metricas && (
        <>
          <div className="metricas-grid">
            <TarjetaMetrica etiqueta="Conversaciones activas" valor={metricas.conversacionesActivas} />
            <TarjetaMetrica etiqueta="Atendidas hoy" valor={metricas.conversacionesAtendidasHoy} />
            <TarjetaMetrica etiqueta="Clientes nuevos" valor={metricas.clientesNuevos} />
            <TarjetaMetrica etiqueta="Atendidas por IA" valor={metricas.atendidoPorIA} />
            <TarjetaMetrica etiqueta="Tomadas por humanos" valor={metricas.atendidoPorHumano} />
            <TarjetaMetrica
              etiqueta="Tiempo promedio de respuesta"
              valor={formatearTiempo(metricas.tiempoPromedioRespuestaMs)}
            />
            <TarjetaMetrica etiqueta="Citas agendadas" valor={metricas.citasAgendadas} />
          </div>

          <h2 className="alertas-titulo">Alertas importantes</h2>
          {metricas.alertas.length === 0 ? (
            <p className="operaciones-nota">Sin alertas — todo en orden.</p>
          ) : (
            <ul className="alertas-lista">
              {metricas.alertas.map((a, i) => (
                <li key={i} className={`alerta alerta--${a.tipo}`}>{a.mensaje}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TarjetaMetrica({ etiqueta, valor }) {
  return (
    <div className="metrica-tarjeta">
      <span className="metrica-valor">{valor ?? '—'}</span>
      <span className="metrica-etiqueta">{etiqueta}</span>
    </div>
  );
}

function formatearTiempo(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
