import { useEffect, useState } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const SEVERIDAD_ESTADO = {
  aceptada: 'success', enviada: 'warning', vista: 'warning',
  rechazada: 'error', vencida: 'error', borrador: 'neutral',
};

// Mismo criterio que modules/permisos.js::esGerencial() en el backend —
// duplicado a propósito en frontend, mismo patrón ya usado en
// Configuracion.jsx/Shell.jsx (sin un módulo compartido cliente/servidor).
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const ETIQUETAS_PROPUESTA = { economica: 'Económica', recomendada: 'Recomendada', ampliada: 'Ampliada' };

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
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const [cotizacion, setCotizacion] = useState(null);
  const [error, setError] = useState(null);
  const [reenviando, setReenviando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [nuevaLinea, setNuevaLinea] = useState({ descripcion: '', cantidad: '1', precioUnitario: '' });
  // Quick win (auditoría 2026-09-16, sección N.4) — autorizarPrecioFinal ya
  // existía en el backend desde Fase 3, sin ningún botón que lo usara.
  const [precioFinalInput, setPrecioFinalInput] = useState('');
  // Aprobación de descuentos (2026-09-22, ver modules/cotizacion-descuento.js).
  const [descuentoPctInput, setDescuentoPctInput] = useState('');
  const [descuentoMontoInput, setDescuentoMontoInput] = useState('');
  const [descuentoMotivoInput, setDescuentoMotivoInput] = useState('');
  const [propuestas, setPropuestas] = useState(null);
  const [simulacion, setSimulacion] = useState(null);
  const [indiceSimulador, setIndiceSimulador] = useState(0);

  function cargar() {
    api.cotizacion(cotizacionId).then(setCotizacion).catch((e) => setError(e.message));
  }

  useEffect(cargar, [cotizacionId]);

  // "3 propuestas": solo si ya hay un cálculo de ingeniería que comparar. Si la
  // consulta falla, la sección simplemente no aparece — es información adicional,
  // nunca debe tumbar el detalle de la cotización.
  useEffect(() => {
    if (!cotizacion?.calculo) { setPropuestas(null); return; }
    api.propuestasCotizacion(cotizacionId).then(setPropuestas).catch(() => setPropuestas(null));
  }, [cotizacionId, cotizacion?.calculo, cotizacion?.paquete_recomendado_id]);

  // Simulador: un solo request trae el rango completo de puntos — el control
  // deslizante solo mueve un índice local, nunca dispara una petición nueva
  // por movimiento. Arranca en el punto técnico (el mismo del cálculo).
  useEffect(() => {
    if (!cotizacion?.calculo) { setSimulacion(null); return; }
    api.simuladorCotizacion(cotizacionId).then((r) => {
      setSimulacion(r);
      const idxTecnico = r?.puntos?.findIndex((p) => p.es_tecnico);
      setIndiceSimulador(idxTecnico > -1 ? idxTecnico : 0);
    }).catch(() => setSimulacion(null));
  }, [cotizacionId, cotizacion?.calculo]);

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

  async function proponerDescuento(e) {
    e.preventDefault();
    const pct = descuentoPctInput.trim() ? Number(descuentoPctInput) : undefined;
    const monto = descuentoMontoInput.trim() ? Number(descuentoMontoInput) : undefined;
    if (pct == null && monto == null) { setError('Captura un % o un monto de descuento.'); return; }
    await conAnimoDeEspera(() => api.aplicarDescuentoCotizacion(cotizacionId, { descuentoPct: pct, descuentoMonto: monto, motivo: descuentoMotivoInput.trim() || undefined }));
    setDescuentoPctInput(''); setDescuentoMontoInput(''); setDescuentoMotivoInput('');
  }

  const autorizarDescuentoPendiente = () => conAnimoDeEspera(() => api.autorizarDescuentoCotizacion(cotizacionId));

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
        {(cotizacion.descuento_pct || cotizacion.descuento_monto) ? (
          <div>
            <p>
              <strong>Descuento:</strong> {cotizacion.descuento_pct ? `${cotizacion.descuento_pct}%` : formatearMonto(cotizacion.descuento_monto)}
              {cotizacion.descuento_motivo && ` — ${cotizacion.descuento_motivo}`}
            </p>
            {cotizacion.limite_descuento_excedido && !cotizacion.descuento_autorizado_por && (
              <p className="login-error">
                Excede el límite permitido — pendiente de autorización de un gerencial.
                {esGerencial && cotizacion.estado === 'borrador' && (
                  <>{' '}<button type="button" className="boton-enlace" disabled={procesando} onClick={autorizarDescuentoPendiente}>Autorizar este descuento</button></>
                )}
              </p>
            )}
            {cotizacion.descuento_autorizado_por && (
              <p className="operaciones-nota">Autorizado el {formatearFechaHora(cotizacion.descuento_autorizado_en)}.</p>
            )}
          </div>
        ) : null}
        {cotizacion.estado === 'borrador' && (
          <form className="config-form-inline" onSubmit={proponerDescuento}>
            <input
              type="number" min="0" max="100" step="0.1" placeholder="Descuento %"
              value={descuentoPctInput} onChange={(e) => { setDescuentoPctInput(e.target.value); setDescuentoMontoInput(''); }}
            />
            <span className="operaciones-nota">o</span>
            <input
              type="number" min="0" placeholder="Descuento en $"
              value={descuentoMontoInput} onChange={(e) => { setDescuentoMontoInput(e.target.value); setDescuentoPctInput(''); }}
            />
            <input
              type="text" placeholder="Motivo (opcional)"
              value={descuentoMotivoInput} onChange={(e) => setDescuentoMotivoInput(e.target.value)}
            />
            <button type="submit" disabled={procesando}>Proponer descuento</button>
          </form>
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

      {propuestas && (propuestas.propuestas.length > 0 || propuestas.motivo) && (
        <section className="crm-seccion">
          <h2>Propuestas</h2>
          {propuestas.propuestas.length === 0 ? (
            <p className="operaciones-nota">{propuestas.motivo}</p>
          ) : (
            <>
              <p className="operaciones-nota">
                Tres opciones reales de tu catálogo de paquetes, calculadas con el consumo de este cliente.
                El ahorro y la recuperación son estimados simples (costo efectivo actual del recibo, sin inflación de tarifa).
              </p>
              <div className="catalogo-tecnico-grid">
                {propuestas.propuestas.map((p) => (
                  <div
                    key={p.tipo}
                    className="catalogo-tecnico-tarjeta"
                    style={p.tipo === 'recomendada' ? { borderColor: 'var(--acento)', borderWidth: 2 } : undefined}
                  >
                    <div className="catalogo-tecnico-marca">{ETIQUETAS_PROPUESTA[p.tipo]}</div>
                    <div className="catalogo-tecnico-modelo">{p.paquete.nombre}</div>
                    <p><strong>{formatearMonto(p.paquete.precio_contado)}</strong> de contado</p>
                    <p className="operaciones-nota">
                      {p.paquete.cantidad_paneles} paneles · {p.kwp != null ? `${p.kwp.toFixed(2)} kWp${p.kwp_fuente === 'estimada_con_panel_del_calculo' ? ' (estimado)' : ''}` : '— kWp'}
                    </p>
                    <p>Cobertura: <strong>{p.cobertura_pct != null ? `${p.cobertura_pct.toFixed(0)} %` : '—'}</strong></p>
                    <p>Ahorro anual: <strong>{formatearMonto(p.ahorro_anual != null ? Math.round(p.ahorro_anual) : null)}</strong></p>
                    <p>Recuperación: <strong>{p.periodo_recuperacion_anios != null ? `${p.periodo_recuperacion_anios.toFixed(1)} años` : '—'}</strong></p>
                    {p.excede_consumo && (
                      <p className="operaciones-nota">Produce más de lo que consume: el ahorro ya no crece y la recuperación se alarga.</p>
                    )}
                    {p.motivos.map((m, i) => <p key={i} className="operaciones-nota">{m}</p>)}
                    {p.tipo === 'recomendada' && (
                      <span className="pill pill--success">
                        {propuestas.paquete_recomendado_actual_id === p.paquete.id ? 'Paquete recomendado de esta cotización' : 'Recomendada'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {propuestas.propuestas.some((p) => p.kwp_fuente === 'estimada_con_panel_del_calculo') && (
                <p className="operaciones-nota">
                  (estimado): los paquetes aún no tienen su potencia registrada, así que los kWp se estiman con el panel elegido en el cálculo.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {simulacion?.puntos?.length > 0 && (
        <section className="crm-seccion">
          <h2>Simulador</h2>
          <p className="operaciones-nota">
            Mueve el número de paneles y mira cómo cambian producción, cobertura, ahorro y recuperación —
            en tiempo real, sin volver a calcular. El precio es el de tu paquete estándar más chico que
            cubre esa cantidad; si no coincide exacto, se marca como referencia.
          </p>
          {(() => {
            const punto = simulacion.puntos[indiceSimulador];
            if (!punto) return null;
            return (
              <div>
                <input
                  type="range" min={0} max={simulacion.puntos.length - 1} value={indiceSimulador}
                  onChange={(e) => setIndiceSimulador(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <p style={{ textAlign: 'center' }}>
                  <strong style={{ fontSize: '1.3rem' }}>{punto.numero_paneles} paneles</strong>
                  {punto.es_tecnico && <span className="pill pill--success" style={{ marginLeft: '0.5rem' }}>número técnico del cálculo</span>}
                </p>
                <div className="catalogo-tecnico-grid">
                  <div className="catalogo-tecnico-tarjeta">
                    <div className="catalogo-tecnico-marca">Sistema</div>
                    <p>{punto.kwp != null ? `${punto.kwp.toFixed(2)} kWp` : '—'}</p>
                    <p className="operaciones-nota">{punto.produccion_anual_kwh != null ? `${Math.round(punto.produccion_anual_kwh).toLocaleString('es-MX')} kWh/año` : '—'}</p>
                  </div>
                  <div className="catalogo-tecnico-tarjeta">
                    <div className="catalogo-tecnico-marca">Cobertura</div>
                    <p>{punto.cobertura_pct != null ? `${punto.cobertura_pct.toFixed(0)} %` : '—'}</p>
                    {punto.excede_consumo && <p className="operaciones-nota">Produce más de lo que consume.</p>}
                  </div>
                  <div className="catalogo-tecnico-tarjeta">
                    <div className="catalogo-tecnico-marca">Ahorro anual</div>
                    <p>{formatearMonto(punto.ahorro_anual != null ? Math.round(punto.ahorro_anual) : null)}</p>
                    <p className="operaciones-nota">Recuperación: {punto.periodo_recuperacion_anios != null ? `${punto.periodo_recuperacion_anios.toFixed(1)} años` : '—'}</p>
                  </div>
                  <div className="catalogo-tecnico-tarjeta">
                    <div className="catalogo-tecnico-marca">Precio de referencia</div>
                    <p>{formatearMonto(punto.paquete_referencia?.precio_contado)}</p>
                    <p className="operaciones-nota">
                      {punto.paquete_referencia
                        ? `${punto.paquete_referencia.nombre}${punto.paquete_referencia.exacto ? '' : ' (referencia — cubre más de lo elegido)'}`
                        : 'Fuera del catálogo estándar — necesitaría un paquete a la medida.'}
                    </p>
                  </div>
                </div>
                {punto.motivos.map((m, i) => <p key={i} className="operaciones-nota">{m}</p>)}
              </div>
            );
          })()}
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
