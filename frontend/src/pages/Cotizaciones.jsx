import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';

// Panel de Cotizaciones (Alina, 2026-08-10) — listado de la empresa activa.
// El backend (modules/cotizaciones.js::listarCotizaciones) ya filtra por
// company_id y por el mismo alcance de rol que la bandeja de revisión
// (gerencial ve todas, un asesor solo las suyas o sin asignar) — este
// componente nunca decide alcance, solo pinta lo que llega.
const SEVERIDAD_ESTADO = {
  aceptada: 'success',
  enviada: 'warning',
  vista: 'warning',
  rechazada: 'error',
  vencida: 'error',
  borrador: 'neutral',
};

function formatearFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

export default function Cotizaciones() {
  const [cotizaciones, setCotizaciones] = useState(null);
  const [error, setError] = useState(null);
  const [reenviandoId, setReenviandoId] = useState(null);

  function cargar() {
    api.cotizaciones().then(setCotizaciones).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function reenviar(id) {
    setReenviandoId(id);
    try {
      await api.reenviarCotizacion(id);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setReenviandoId(null);
    }
  }

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Cotizaciones</h1>
        <NavLink to="/cotizaciones/nueva">+ Nueva cotización</NavLink>
      </div>

      {error && <p className="login-error">{error}</p>}
      {cotizaciones === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {cotizaciones?.length === 0 && <p className="operaciones-nota">Todavía no hay cotizaciones generadas.</p>}

      {cotizaciones && cotizaciones.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Folio</th><th>Cliente</th><th>Teléfono</th><th>Producto</th>
              <th>Total</th><th>Fecha</th><th>Estatus</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cotizaciones.map((c) => (
              <tr key={c.id}>
                <td>{c.folio || <span className="operaciones-nota">sin folio</span>}</td>
                <td>{c.clientes?.nombre || '—'}</td>
                <td>{c.clientes?.telefono || '—'}</td>
                <td>{c.producto || '—'}</td>
                <td>{formatearMonto(c.total)}</td>
                <td>{formatearFecha(c.created_at)}</td>
                <td><span className={`pill pill--${SEVERIDAD_ESTADO[c.estado] || 'neutral'}`}>{c.estado}</span></td>
                <td>
                  <div className="cotizacion-acciones">
                    <NavLink to={`/cotizaciones/${c.id}`}>Ver</NavLink>
                    {c.pdf_url && (
                      <>
                        {' · '}
                        <a href={api.urlPdfCotizacion(c.id)} target="_blank" rel="noreferrer">Abrir PDF</a>
                        {' · '}
                        <a href={api.urlPdfCotizacion(c.id)} download>Descargar</a>
                      </>
                    )}
                    {' · '}
                    <button
                      type="button" className="boton-enlace"
                      disabled={reenviandoId === c.id}
                      onClick={() => reenviar(c.id)}
                    >
                      {reenviandoId === c.id ? 'Enviando…' : 'Reenviar por WhatsApp'}
                    </button>
                    {c.hilo_id && (
                      <>
                        {' · '}
                        <NavLink to={`/inbox/${c.hilo_id}`}>Ver conversación</NavLink>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
