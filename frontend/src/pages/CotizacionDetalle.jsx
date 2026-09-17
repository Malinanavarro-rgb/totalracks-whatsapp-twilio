import { useEffect, useState } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { api } from '../lib/api';

const SEVERIDAD_ESTADO = {
  aceptada: 'success', enviada: 'warning', vista: 'warning',
  rechazada: 'error', vencida: 'error', borrador: 'neutral',
};

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

// Historial (punto 4): Creada → PDF generado → Enviada → Vista/Aceptada/
// Rechazada — solo los eventos que el sistema REALMENTE puede medir hoy
// (created_at, pdf_url, envios_documento, vista_en/aceptada_en/
// rechazada_en). Nada de eventos que no existan todavía (ej. "leída" sin
// webhook de status de WhatsApp) — mismo criterio honesto que ya usa el
// resto del proyecto (ver mapearCapturedFieldsAInfoTecnica, nunca adivina).
function construirHistorial(cotizacion) {
  const eventos = [{ texto: 'Cotización creada', fecha: cotizacion.created_at }];

  if (cotizacion.pdf_url) {
    // No hay un timestamp propio de "cuándo se generó el PDF" — el primer
    // envío (o, si nunca se envió, el momento de guardar cotizacion.pdf_url)
    // es la mejor aproximación real disponible, nunca inventada.
    const primerEnvio = [...(cotizacion.envios || [])].sort((a, b) => a.enviado_en.localeCompare(b.enviado_en))[0];
    eventos.push({ texto: 'PDF generado', fecha: primerEnvio?.enviado_en || null });
  }

  for (const envio of [...(cotizacion.envios || [])].reverse()) {
    eventos.push({
      texto: envio.estado === 'enviado' ? `Enviada por WhatsApp (${envio.proveedor})` : `Intento de envío fallido (${envio.proveedor})`,
      fecha: envio.enviado_en,
    });
  }

  if (cotizacion.vista_en) eventos.push({ texto: 'Vista por el cliente', fecha: cotizacion.vista_en });
  if (cotizacion.aceptada_en) eventos.push({ texto: 'Aceptada', fecha: cotizacion.aceptada_en });
  if (cotizacion.rechazada_en) eventos.push({ texto: 'Rechazada', fecha: cotizacion.rechazada_en });

  return eventos.filter(e => e.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export default function CotizacionDetalle() {
  const { cotizacionId } = useParams();
  const [cotizacion, setCotizacion] = useState(null);
  const [error, setError] = useState(null);
  const [reenviando, setReenviando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [nuevaLinea, setNuevaLinea] = useState({ descripcion: '', cantidad: '1', precioUnitario: '' });
  // Quick win (auditoría 2026-09-16, sección N.4) — autorizarPrecioFinal ya
  // existía en el backend desde Fase 3, sin ningún botón que lo usara.
  const [precioFinalInput, setPrecioFinalInput] = useState('');

  function cargar() {
    api.cotizacion(cotizacionId).then(setCotizacion).catch((e) => setError(e.message));
  }

  useEffect(cargar, [cotizacionId]);

  async function reenviar() {
    setReenviando(true);
    try {
      await api.reenviarCotizacion(cotizacionId);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setReenviando(false);
    }
  }

  // Acciones manuales (Alina, 2026-09-15) — todas existían en el backend
  // desde Fase 2/3, pero ninguna tenía botón todavía. Solo aplican mientras
  // la cotización sigue en borrador; una vez enviada, esta vista vuelve a
  // ser de solo lectura (ver secciones de abajo, que ya eran read-only).
  async function conAnimoDeEspera(accion) {
    setProcesando(true);
    setError(null);
    try {
      await accion();
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setProcesando(false);
    }
  }

  const usarPaqueteRecomendado = () => conAnimoDeEspera(() => api.aplicarCalculoALineasCotizacion(cotizacionId));
  const validar = () => conAnimoDeEspera(() => api.validarIngenieria(cotizacionId));
  const generarPdf = () => conAnimoDeEspera(() => api.generarPdfCotizacionManual(cotizacionId));

  async function autorizarPrecio(e) {
    e.preventDefault();
    const precioFinal = precioFinalInput.trim() ? Number(precioFinalInput) : undefined;
    await conAnimoDeEspera(() => api.autorizarPrecioCotizacion(cotizacionId, precioFinal));
    setPrecioFinalInput('');
  }

  async function agregarLinea(e) {
    e.preventDefault();
    if (!nuevaLinea.descripcion.trim()) return;
    await conAnimoDeEspera(() => api.agregarLineaCotizacion(cotizacionId, {
      descripcion: nuevaLinea.descripcion,
      cantidad: Number(nuevaLinea.cantidad) || 1,
      precioUnitario: Number(nuevaLinea.precioUnitario) || 0,
      origen: 'manual',
    }));
    setNuevaLinea({ descripcion: '', cantidad: '1', precioUnitario: '' });
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!cotizacion) return <p className="operaciones-nota">Cargando…</p>;

  const historial = construirHistorial(cotizacion);

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>{cotizacion.folio || `Cotización #${cotizacion.id}`}</h1>
        <span className={`pill pill--${SEVERIDAD_ESTADO[cotizacion.estado] || 'neutral'}`}>{cotizacion.estado}</span>
      </div>

      <section className="crm-seccion">
        <h2>Datos generales</h2>
        <p><strong>Cliente:</strong> {cotizacion.clientes?.nombre || '—'}</p>
        <p><strong>Teléfono:</strong> {cotizacion.clientes?.telefono || '—'}</p>
        <p><strong>Fecha:</strong> {formatearFechaHora(cotizacion.created_at)}</p>
        <p><strong>Versión:</strong> V{cotizacion.version || 1}</p>
        <p><strong>Total:</strong> {formatearMonto(cotizacion.total)}</p>
        {(cotizacion.descuento_pct || cotizacion.descuento_monto) && (
          <p><strong>Descuento:</strong> {cotizacion.descuento_pct ? `${cotizacion.descuento_pct}%` : formatearMonto(cotizacion.descuento_monto)}</p>
        )}
        {cotizacion.paquetes_solares?.nombre && <p><strong>Paquete:</strong> {cotizacion.paquetes_solares.nombre}</p>}
        <p>
          <strong>Precio final autorizado:</strong>{' '}
          {cotizacion.precio_final_autorizado != null ? formatearMonto(cotizacion.precio_final_autorizado) : 'Todavía no autorizado — usa el paquete recomendado'}
        </p>
        {cotizacion.estado === 'borrador' && (
          <form className="config-form-inline" onSubmit={autorizarPrecio}>
            <input
              type="number" min="0" placeholder="Nuevo precio final (opcional — vacío usa el paquete recomendado)"
              value={precioFinalInput} onChange={(e) => setPrecioFinalInput(e.target.value)}
            />
            <button type="submit" disabled={procesando}>Autorizar precio final</button>
          </form>
        )}
        <p>
          <strong>Conversación relacionada:</strong>{' '}
          {cotizacion.hilo_id ? <NavLink to={`/inbox/${cotizacion.hilo_id}`}>Ver conversación</NavLink> : '— sin conversación asociada'}
        </p>
        <p>
          <strong>Oportunidad relacionada:</strong>{' '}
          {cotizacion.oportunidad_id ? <NavLink to={`/crm/clientes/${cotizacion.cliente_id}`}>Ver oportunidad</NavLink> : '— sin oportunidad asociada'}
        </p>
      </section>

      {cotizacion.calculo && (
        <section className="crm-seccion">
          <h2>Sistema calculado</h2>
          <p>
            <strong>Paneles:</strong> {cotizacion.calculo.resultados?.numero_paneles?.valor ?? '—'}
            {' · '}
            <strong>Potencia instalada:</strong> {cotizacion.calculo.resultados?.potencia_instalada_kwp != null ? `${cotizacion.calculo.resultados.potencia_instalada_kwp.toFixed(2)} kWp` : '—'}
            {' · '}
            <strong>Estado del cálculo:</strong> {cotizacion.calculo.estado_calculo}
          </p>

          {(cotizacion.calculo.alertas || []).length > 0 && (
            <ul className="config-kb-lista">
              {cotizacion.calculo.alertas.map((a, i) => (
                <li key={i} className="config-kb-item">
                  <span className={`pill pill--${a.severidad === 'bloqueo' ? 'error' : 'warning'}`}>{a.severidad}</span>{' '}
                  {a.mensaje}
                </li>
              ))}
            </ul>
          )}

          {cotizacion.paquetes_solares?.nombre && cotizacion.estado === 'borrador' && (
            <p>
              Paquete recomendado: <strong>{cotizacion.paquetes_solares.nombre}</strong>
              {' — '}{formatearMonto(cotizacion.paquetes_solares.precio_contado)}
              {' · '}
              <button type="button" className="boton-enlace" disabled={procesando} onClick={usarPaqueteRecomendado}>
                Usar este paquete
              </button>
            </p>
          )}
        </section>
      )}

      <section className="crm-seccion">
        <h2>Productos o servicios</h2>
        {(!cotizacion.lineas || cotizacion.lineas.length === 0) ? (
          <p className="operaciones-nota">Sin líneas registradas.</p>
        ) : (
          <table>
            <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
            <tbody>
              {cotizacion.lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.descripcion}</td>
                  <td>{l.cantidad}</td>
                  <td>{formatearMonto(l.precio_unitario)}</td>
                  <td>{formatearMonto(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {cotizacion.estado === 'borrador' && (
          <form className="config-form-inline" onSubmit={agregarLinea}>
            <input
              type="text" placeholder="Descripción (ej. Instalación y mano de obra)"
              value={nuevaLinea.descripcion}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, descripcion: e.target.value })}
            />
            <input
              type="number" min="0" step="1" placeholder="Cantidad" style={{ maxWidth: '90px' }}
              value={nuevaLinea.cantidad}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, cantidad: e.target.value })}
            />
            <input
              type="number" min="0" placeholder="Precio unitario" style={{ maxWidth: '140px' }}
              value={nuevaLinea.precioUnitario}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, precioUnitario: e.target.value })}
            />
            <button type="submit" disabled={procesando}>Agregar línea</button>
          </form>
        )}
      </section>

      {cotizacion.estado === 'borrador' && (
        <section className="crm-seccion">
          <h2>Validar y generar</h2>
          {cotizacion.ingenieria_validada_para_cotizar_en ? (
            <p className="operaciones-nota">Ingeniería ya validada — lista para generar el PDF.</p>
          ) : (
            <p>
              <button
                type="button" disabled={procesando || cotizacion.calculo?.estado_calculo !== 'completo' || !cotizacion.lineas?.length}
                onClick={validar}
              >
                Validar ingeniería para cotizar
              </button>
              {cotizacion.calculo?.estado_calculo !== 'completo' && (
                <span className="operaciones-nota"> — el cálculo tiene alertas de bloqueo, revísalas arriba.</span>
              )}
              {cotizacion.calculo?.estado_calculo === 'completo' && !cotizacion.lineas?.length && (
                <span className="operaciones-nota"> — agrega al menos una línea (usa el paquete recomendado o agrega una manual).</span>
              )}
            </p>
          )}

          {cotizacion.ingenieria_validada_para_cotizar_en && !cotizacion.pdf_url && (
            <p>
              <button type="button" disabled={procesando} onClick={generarPdf}>
                {procesando ? 'Generando…' : 'Generar PDF'}
              </button>
            </p>
          )}
        </section>
      )}

      <section className="crm-seccion">
        <h2>PDF</h2>
        {cotizacion.pdf_url ? (
          <p>
            <a href={api.urlPdfCotizacion(cotizacion.id)} target="_blank" rel="noreferrer">Abrir PDF</a>
            {' · '}
            <a href={api.urlPdfCotizacion(cotizacion.id)} download>Descargar</a>
            {' · '}
            <button type="button" className="boton-enlace" disabled={reenviando} onClick={reenviar}>
              {reenviando ? 'Enviando…' : 'Reenviar por WhatsApp'}
            </button>
          </p>
        ) : (
          <p className="operaciones-nota">Todavía no se ha generado un PDF para esta cotización.</p>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Historial</h2>
        {historial.length === 0 ? (
          <p className="operaciones-nota">Sin eventos registrados todavía.</p>
        ) : (
          <ul className="config-kb-lista">
            {historial.map((e, i) => (
              <li key={i} className="config-kb-item">
                <strong>{e.texto}</strong> — {formatearFechaHora(e.fecha)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
