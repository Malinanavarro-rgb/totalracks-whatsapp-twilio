import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Mismo criterio que modules/permisos.js::esGerencial() en el backend —
// duplicado a propósito en frontend (patrón ya usado en CotizacionDetalle.jsx).
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

// Progreso del proyecto (Subfase 2A, 2026-09-22) — "Venta" y "Cobranza" ya
// tienen datos reales; el resto se muestra deliberadamente como "todavía no
// existe ese módulo" en vez de simular un estado — se activan uno por uno
// en las subfases 2C-2I.
const PASOS_PROGRESO = [
  { clave: 'venta', etiqueta: 'Venta' },
  { clave: 'cobranza', etiqueta: 'Cobranza' },
  { clave: 'levantamiento', etiqueta: 'Levantamiento' },
  { clave: 'material', etiqueta: 'Material' },
  { clave: 'instalacion', etiqueta: 'Instalación' },
  { clave: 'cfe', etiqueta: 'CFE' },
  { clave: 'entrega', etiqueta: 'Entrega' },
  { clave: 'postventa', etiqueta: 'Garantía / Postventa' },
];

const ETIQUETA_ESTADO_COBRANZA = {
  pendiente_anticipo: 'Pendiente de anticipo', anticipo_recibido: 'Anticipo recibido',
  pago_parcial: 'Pago parcial', liquidado: 'Liquidado', vencido: 'Vencido',
};
const SEVERIDAD_ESTADO_COBRANZA = { liquidado: 'success', pago_parcial: 'warning', anticipo_recibido: 'warning', vencido: 'error', pendiente_anticipo: 'neutral' };

// Subfase 2C (2026-09-23) — mismos 10 estados que modules/instalaciones.js::ESTADOS_INSTALACION.
const ETIQUETA_ESTADO_INSTALACION = {
  por_programar: 'Por programar', programada: 'Programada', preparando_material: 'Preparando material',
  lista_para_instalacion: 'Lista para instalación', en_camino: 'En camino', instalando: 'Instalando',
  pruebas: 'Pruebas', terminada: 'Terminada', pendiente_documentacion: 'Pendiente de documentación', entregada: 'Entregada',
};
const SEVERIDAD_ESTADO_INSTALACION = { entregada: 'success', terminada: 'success', por_programar: 'neutral' };

function formatearFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatearMonto(monto) {
  if (monto == null) return '—';
  return `$${Number(monto).toLocaleString('es-MX')}`;
}

export default function ProyectoDetalle() {
  const { proyectoId } = useParams();
  const { sesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const [proyecto, setProyecto] = useState(null);
  const [error, setError] = useState(null);
  const [cobranza, setCobranza] = useState(null);
  const [errorCobranza, setErrorCobranza] = useState(null);
  const [formAbono, setFormAbono] = useState({ monto: '', formaPago: 'transferencia', referencia: '', fecha: '', notas: '' });
  const [registrando, setRegistrando] = useState(false);
  const [anticipoInput, setAnticipoInput] = useState('');
  const [guardandoAnticipo, setGuardandoAnticipo] = useState(false);
  // Subfase 2C (2026-09-23) — instalaciones de este proyecto.
  const [instalaciones, setInstalaciones] = useState(null);
  const [errorInstalacion, setErrorInstalacion] = useState(null);
  const [creandoInstalacion, setCreandoInstalacion] = useState(false);

  useEffect(() => {
    api.proyecto(proyectoId).then(setProyecto).catch((e) => setError(e.message));
  }, [proyectoId]);

  function cargarCobranza() {
    api.cobranzaProyecto(proyectoId).then((r) => { setCobranza(r); setErrorCobranza(null); }).catch((e) => setErrorCobranza(e.message));
  }

  useEffect(cargarCobranza, [proyectoId]);

  function cargarInstalaciones() {
    api.instalacionesDeProyecto(proyectoId).then((r) => { setInstalaciones(r); setErrorInstalacion(null); }).catch((e) => setErrorInstalacion(e.message));
  }

  useEffect(cargarInstalaciones, [proyectoId]);

  async function crearInstalacionActual() {
    setCreandoInstalacion(true);
    setErrorInstalacion(null);
    try {
      await api.crearInstalacion(proyectoId, {});
      cargarInstalaciones();
    } catch (e2) {
      setErrorInstalacion(e2.message);
    } finally {
      setCreandoInstalacion(false);
    }
  }

  async function cambiarEstadoInstalacion(instalacionId, estado) {
    try {
      await api.actualizarEstadoInstalacion(instalacionId, estado);
      cargarInstalaciones();
    } catch (e2) {
      setErrorInstalacion(e2.message);
    }
  }

  async function marcarChecklistItem(instalacionId, clave, completado) {
    try {
      await api.actualizarChecklistItem(instalacionId, clave, completado);
      cargarInstalaciones();
    } catch (e2) {
      setErrorInstalacion(e2.message);
    }
  }

  async function registrarAbonoActual(e) {
    e.preventDefault();
    const monto = Number(formAbono.monto);
    if (!(monto > 0)) { setErrorCobranza('Captura un monto mayor a 0.'); return; }
    setRegistrando(true);
    setErrorCobranza(null);
    try {
      await api.registrarAbono(proyectoId, {
        monto, formaPago: formAbono.formaPago || undefined, referencia: formAbono.referencia || undefined,
        fecha: formAbono.fecha || undefined, notas: formAbono.notas || undefined,
      });
      setFormAbono({ monto: '', formaPago: 'transferencia', referencia: '', fecha: '', notas: '' });
      cargarCobranza();
    } catch (e2) {
      setErrorCobranza(e2.message);
    } finally {
      setRegistrando(false);
    }
  }

  async function guardarAnticipo(e) {
    e.preventDefault();
    setGuardandoAnticipo(true);
    try {
      await api.actualizarAnticipoRequerido(proyectoId, anticipoInput.trim() === '' ? null : Number(anticipoInput));
      setAnticipoInput('');
      cargarCobranza();
    } catch (e2) {
      setErrorCobranza(e2.message);
    } finally {
      setGuardandoAnticipo(false);
    }
  }

  if (error) return <p className="login-error">{error}</p>;
  if (!proyecto) return <p className="operaciones-nota">Cargando…</p>;

  const v = proyecto.config_vendida || {};

  return (
    <div>
      <div className="crm-seccion-header">
        <h1>Proyecto {proyecto.numero_proyecto || `#${proyecto.id}`}</h1>
        <span className="pill pill--success">Venta cerrada</span>
      </div>

      <section className="crm-seccion">
        <h2>Encabezado</h2>
        <dl className="crm-datos-lista">
          <dt>Cliente</dt><dd>{proyecto.cliente_id ? <Link to={`/crm/clientes/${proyecto.cliente_id}`}>{proyecto.cliente_nombre || `Cliente #${proyecto.cliente_id}`}</Link> : '—'}</dd>
          <dt>Teléfono</dt><dd>{proyecto.cliente_telefono || '—'}</dd>
          <dt>Ubicación</dt><dd>{proyecto.ubicacion_instalacion || '—'}</dd>
          <dt>Sucursal</dt><dd>{proyecto.sucursal_nombre || '—'}</dd>
          <dt>Asesor</dt><dd>{proyecto.asesor_nombre || '—'}</dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Sistema vendido</h2>
        {v.panel ? (
          <dl className="crm-datos-lista">
            <dt>Paneles</dt><dd>{v.panel.cantidad ?? '—'} × {v.panel.marca} {v.panel.modelo}</dd>
            <dt>Potencia</dt><dd>{v.potencia_instalada_kwp != null ? `${v.potencia_instalada_kwp.toFixed(2)} kWp` : '—'}</dd>
            <dt>Inversor</dt><dd>{v.inversor ? `${v.inversor.marca} ${v.inversor.modelo}` : '—'}</dd>
            <dt>Cobertura estimada</dt><dd>{v.cobertura_pct != null ? `${v.cobertura_pct.toFixed(0)}%` : '—'}</dd>
            <dt>Generación estimada</dt><dd>{v.produccion_anual_kwh != null ? `${Math.round(v.produccion_anual_kwh).toLocaleString('es-MX')} kWh/año` : '—'}</dd>
          </dl>
        ) : (
          <p className="operaciones-nota">Esta cotización no tenía un cálculo de ingeniería corrido al momento de aceptarse.</p>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Información comercial</h2>
        <dl className="crm-datos-lista">
          <dt>Cotización</dt><dd><Link to={`/cotizaciones/${proyecto.cotizacion_id}`}>{v.cotizacion_folio || `#${proyecto.cotizacion_id}`}</Link></dd>
          <dt>Total</dt><dd>{formatearMonto(v.precio_final_autorizado ?? v.total)}</dd>
          <dt>Paquete</dt><dd>{v.paquete_recomendado || '—'}</dd>
          <dt>Fecha de aceptación</dt><dd>{formatearFechaHora(proyecto.created_at)}</dd>
          <dt>Estado general</dt><dd><span className="pill pill--success">{proyecto.estado}</span></dd>
        </dl>
      </section>

      <section className="crm-seccion">
        <h2>Cobranza</h2>
        {errorCobranza && <p className="login-error">{errorCobranza}</p>}
        {!cobranza ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : (
          <>
            <dl className="crm-datos-lista">
              <dt>Total vendido</dt><dd>{formatearMonto(cobranza.total_vendido)}</dd>
              <dt>Anticipo requerido</dt>
              <dd>
                {formatearMonto(cobranza.anticipo_requerido_monto)}{cobranza.anticipo_requerido_pct != null ? ` (${cobranza.anticipo_requerido_pct}%)` : ''}
                {!cobranza.anticipo_requerido_pct && ' — no capturado en la cotización'}
              </dd>
              <dt>Total pagado</dt><dd>{formatearMonto(cobranza.total_pagado)}</dd>
              <dt>Saldo</dt><dd>{formatearMonto(cobranza.saldo)}</dd>
              <dt>% pagado</dt><dd>{cobranza.pct_pagado != null ? `${cobranza.pct_pagado.toFixed(0)}%` : '—'}</dd>
              <dt>Estado</dt><dd><span className={`pill pill--${SEVERIDAD_ESTADO_COBRANZA[cobranza.estado] || 'neutral'}`}>{ETIQUETA_ESTADO_COBRANZA[cobranza.estado] || '—'}</span></dd>
            </dl>

            {esGerencial && (
              <form className="config-form-inline" onSubmit={guardarAnticipo}>
                <input type="number" min="0" max="100" step="0.01" placeholder="% de anticipo requerido"
                  value={anticipoInput} onChange={(e) => setAnticipoInput(e.target.value)} />
                <button type="submit" disabled={guardandoAnticipo}>Confirmar anticipo</button>
              </form>
            )}

            <h3>Abonos</h3>
            {cobranza.abonos.length === 0 ? (
              <p className="operaciones-nota">Sin pagos registrados todavía.</p>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Monto</th><th>Forma de pago</th><th>Referencia</th><th>Notas</th></tr></thead>
                <tbody>
                  {cobranza.abonos.map((a) => (
                    <tr key={a.id}>
                      <td>{formatearFecha(a.fecha)}</td><td>{formatearMonto(a.monto)}</td>
                      <td>{a.forma_pago || '—'}</td><td>{a.referencia || '—'}</td><td>{a.notas || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3>Registrar pago</h3>
            <form className="config-form-inline" onSubmit={registrarAbonoActual}>
              <input type="number" min="0" step="0.01" placeholder="Monto" required
                value={formAbono.monto} onChange={(e) => setFormAbono({ ...formAbono, monto: e.target.value })} />
              <select value={formAbono.formaPago} onChange={(e) => setFormAbono({ ...formAbono, formaPago: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
                <option value="otro">Otro</option>
              </select>
              <input type="text" placeholder="Referencia" value={formAbono.referencia} onChange={(e) => setFormAbono({ ...formAbono, referencia: e.target.value })} />
              <input type="date" value={formAbono.fecha} onChange={(e) => setFormAbono({ ...formAbono, fecha: e.target.value })} />
              <input type="text" placeholder="Notas" value={formAbono.notas} onChange={(e) => setFormAbono({ ...formAbono, notas: e.target.value })} />
              <button type="submit" disabled={registrando}>{registrando ? 'Guardando…' : 'Registrar pago'}</button>
            </form>
          </>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Instalación</h2>
        {errorInstalacion && <p className="login-error">{errorInstalacion}</p>}
        {instalaciones === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : instalaciones.length === 0 ? (
          <>
            <p className="operaciones-nota">Este proyecto todavía no tiene una instalación programada.</p>
            <button type="button" onClick={crearInstalacionActual} disabled={creandoInstalacion}>
              {creandoInstalacion ? 'Creando…' : 'Crear instalación'}
            </button>
          </>
        ) : (
          instalaciones.map((inst) => {
            const totalItems = inst.checklist?.length || 0;
            const completados = (inst.checklist || []).filter((it) => it.completado).length;
            return (
              <div key={inst.id} style={{ marginBottom: '1.5rem' }}>
                <dl className="crm-datos-lista">
                  <dt>Estado</dt>
                  <dd>
                    <select value={inst.estado} onChange={(e) => cambiarEstadoInstalacion(inst.id, e.target.value)}>
                      {Object.entries(ETIQUETA_ESTADO_INSTALACION).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
                    </select>
                    {' '}<span className={`pill pill--${SEVERIDAD_ESTADO_INSTALACION[inst.estado] || 'warning'}`}>{ETIQUETA_ESTADO_INSTALACION[inst.estado]}</span>
                  </dd>
                  <dt>Fecha programada</dt><dd>{inst.fecha_programada ? formatearFecha(inst.fecha_programada) : '—'}{inst.hora_programada ? ` · ${inst.hora_programada}` : ''}</dd>
                  <dt>Sucursal</dt><dd>{inst.sucursal_nombre || '—'}</dd>
                  <dt>Responsable</dt><dd>{inst.responsable_nombre || '—'}</dd>
                  <dt>Cuadrilla</dt><dd>{inst.cuadrilla?.length ? inst.cuadrilla.join(', ') : '—'}</dd>
                  <dt>Sistema</dt>
                  <dd>
                    {inst.detalle_tecnico?.numero_paneles ?? '—'} paneles · {inst.detalle_tecnico?.potencia_kwp != null ? `${inst.detalle_tecnico.potencia_kwp.toFixed(2)} kWp` : '—'}
                    {' · '}{inst.detalle_tecnico?.inversor ? `${inst.detalle_tecnico.inversor.marca} ${inst.detalle_tecnico.inversor.modelo}` : 'inversor —'}
                    {' · '}estructura: {inst.detalle_tecnico?.estructura || '— (sin capturar)'}
                  </dd>
                </dl>

                <h3>Checklist ({completados}/{totalItems})</h3>
                {totalItems === 0 ? (
                  <p className="operaciones-nota">Esta empresa todavía no tiene un checklist de instalación configurado.</p>
                ) : (
                  <ul className="config-kb-lista">
                    {inst.checklist.map((item) => (
                      <li key={item.clave} className="config-kb-item">
                        <label>
                          <input type="checkbox" checked={item.completado} onChange={(e) => marcarChecklistItem(inst.id, item.clave, e.target.checked)} />
                          {' '}{item.etiqueta}
                        </label>
                        {item.completado && <span className="operaciones-nota"> — {formatearFechaHora(item.completado_en)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="crm-seccion">
        <h2>Progreso</h2>
        <ul className="config-kb-lista">
          {PASOS_PROGRESO.map((paso) => {
            if (paso.clave === 'venta') {
              return (
                <li key={paso.clave} className="config-kb-item">
                  <span className="pill pill--success">✓</span> {paso.etiqueta} — {formatearFechaHora(proyecto.created_at)}
                </li>
              );
            }
            if (paso.clave === 'cobranza' && cobranza?.estado) {
              return (
                <li key={paso.clave} className="config-kb-item">
                  <span className={`pill pill--${SEVERIDAD_ESTADO_COBRANZA[cobranza.estado] || 'neutral'}`}>{cobranza.estado === 'liquidado' ? '✓' : '·'}</span>
                  {' '}{paso.etiqueta} — {ETIQUETA_ESTADO_COBRANZA[cobranza.estado]}
                </li>
              );
            }
            if (paso.clave === 'instalacion' && instalaciones?.length > 0) {
              const inst = instalaciones[0];
              const completada = inst.estado === 'entregada' || inst.estado === 'terminada';
              return (
                <li key={paso.clave} className="config-kb-item">
                  <span className={`pill pill--${SEVERIDAD_ESTADO_INSTALACION[inst.estado] || 'warning'}`}>{completada ? '✓' : '·'}</span>
                  {' '}{paso.etiqueta} — {ETIQUETA_ESTADO_INSTALACION[inst.estado]}
                </li>
              );
            }
            return (
              <li key={paso.clave} className="config-kb-item">
                <span className="pill pill--neutral">—</span> {paso.etiqueta} <span className="operaciones-nota">(módulo todavía no implementado)</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
