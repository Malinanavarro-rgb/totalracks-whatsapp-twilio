import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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

// Subfase 2E (2026-09-28) — mismos 10 estados que modules/tramites-cfe.js::ESTADOS_TRAMITE_CFE.
const ESTADOS_CFE = [
  'pendiente', 'documentos_en_revision', 'ingresado_cfe', 'en_revision_cfe',
  'visita_tecnica_programada', 'visita_tecnica_realizada', 'contrato_firmado',
  'medidor_solicitado', 'medidor_instalado', 'interconexion_completada',
];
const ETIQUETA_ESTADO_CFE = {
  pendiente: 'Pendiente', documentos_en_revision: 'Documentos en revisión', ingresado_cfe: 'Ingresado a CFE',
  en_revision_cfe: 'En revisión por CFE', visita_tecnica_programada: 'Visita técnica programada',
  visita_tecnica_realizada: 'Visita técnica realizada', contrato_firmado: 'Contrato firmado',
  medidor_solicitado: 'Medidor solicitado', medidor_instalado: 'Medidor instalado', interconexion_completada: 'Interconexión completada',
};
const SEVERIDAD_ESTADO_CFE = { interconexion_completada: 'success', pendiente: 'neutral' };

// Subfase 2I (2026-09-28) — estado derivado, nunca guardado (modules/mantenimientos.js::calcularEstadoMantenimiento).
const ETIQUETA_ESTADO_MANTENIMIENTO = { pendiente: 'Pendiente', programado: 'Programado', vencido: 'Vencido', realizado: 'Realizado' };
const SEVERIDAD_ESTADO_MANTENIMIENTO = { realizado: 'success', vencido: 'error', programado: 'warning', pendiente: 'neutral' };

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
  const navegar = useNavigate();
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
  // Subfase 2D (2026-09-25) — equipos instalados ("mis paneles/productos" a futuro para el cliente).
  const [equipos, setEquipos] = useState(null);
  const [errorEquipos, setErrorEquipos] = useState(null);
  const [formEquipo, setFormEquipo] = useState({ tipoEquipo: 'panel', marca: '', modelo: '', numeroSerie: '', potenciaCapacidad: '', garantiaMeses: '' });
  const [registrandoEquipo, setRegistrandoEquipo] = useState(false);
  // Subfase 2E (2026-09-28) — trámite CFE de este proyecto.
  const [tramiteCfe, setTramiteCfe] = useState(undefined); // undefined = cargando, null = no existe todavía
  const [errorCfe, setErrorCfe] = useState(null);
  const [iniciandoCfe, setIniciandoCfe] = useState(false);
  const [cambiandoEstadoCfe, setCambiandoEstadoCfe] = useState(false);
  const [documentosCfe, setDocumentosCfe] = useState(null);
  const [subiendoDocCfe, setSubiendoDocCfe] = useState(false);
  // Subfase 2I (2026-09-28) — mantenimientos de este proyecto.
  const [mantenimientos, setMantenimientos] = useState(null);
  const [errorMantenimiento, setErrorMantenimiento] = useState(null);
  const [tecnicos, setTecnicos] = useState([]);
  const [formMantenimiento, setFormMantenimiento] = useState({ tipo: 'preventivo', tecnicoId: '' });
  const [creandoMantenimiento, setCreandoMantenimiento] = useState(false);
  const [formSiguiente, setFormSiguiente] = useState({}); // { [mantenimientoId]: { inicio, fin } }
  const [programandoId, setProgramandoId] = useState(null);

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

  function cargarEquipos() {
    api.equiposDeProyecto(proyectoId).then((r) => { setEquipos(r); setErrorEquipos(null); }).catch((e) => setErrorEquipos(e.message));
  }

  useEffect(cargarEquipos, [proyectoId]);

  async function registrarEquipo(instalacionId, e) {
    e.preventDefault();
    setRegistrandoEquipo(true);
    setErrorEquipos(null);
    try {
      await api.crearEquipoInstalado(instalacionId, {
        ...formEquipo,
        garantiaMeses: formEquipo.garantiaMeses === '' ? undefined : Number(formEquipo.garantiaMeses),
      });
      setFormEquipo({ tipoEquipo: 'panel', marca: '', modelo: '', numeroSerie: '', potenciaCapacidad: '', garantiaMeses: '' });
      cargarEquipos();
    } catch (e2) {
      setErrorEquipos(e2.message);
    } finally {
      setRegistrandoEquipo(false);
    }
  }

  // Subfase 2H (2026-09-28) — "Ver garantía": idempotente (crearGarantiaDesdeEquipo
  // devuelve la existente si ya se había creado), así que un solo botón sirve
  // tanto para crearla la primera vez como para verla después.
  async function verGarantiaDeEquipo(equipoId) {
    try {
      const garantia = await api.crearGarantiaDesdeEquipo(equipoId);
      navegar(`/garantias/${garantia.id}`);
    } catch (e2) {
      setErrorEquipos(e2.message);
    }
  }

  function cargarTramiteCfe() {
    api.tramiteCfeDeProyecto(proyectoId).then((r) => { setTramiteCfe(r); setErrorCfe(null); }).catch((e) => setErrorCfe(e.message));
  }

  useEffect(cargarTramiteCfe, [proyectoId]);

  function cargarDocumentosCfe(clienteId) {
    api.documentosCliente(clienteId, 'tramite_cfe').then(setDocumentosCfe).catch((e) => setErrorCfe(e.message));
  }

  useEffect(() => {
    if (proyecto?.cliente_id) cargarDocumentosCfe(proyecto.cliente_id);
  }, [proyecto?.cliente_id]);

  async function iniciarTramiteCfe() {
    setIniciandoCfe(true);
    setErrorCfe(null);
    try {
      await api.crearTramiteCfe(proyectoId);
      cargarTramiteCfe();
    } catch (e2) {
      setErrorCfe(e2.message);
    } finally {
      setIniciandoCfe(false);
    }
  }

  async function cambiarEstadoCfe(estado) {
    setCambiandoEstadoCfe(true);
    setErrorCfe(null);
    try {
      await api.actualizarEstadoTramiteCfe(tramiteCfe.id, estado);
      cargarTramiteCfe();
    } catch (e2) {
      setErrorCfe(e2.message);
    } finally {
      setCambiandoEstadoCfe(false);
    }
  }

  async function guardarCampoCfe(campo, valor) {
    setErrorCfe(null);
    try {
      await api.actualizarTramiteCfe(tramiteCfe.id, { [campo]: valor });
      cargarTramiteCfe();
    } catch (e2) {
      setErrorCfe(e2.message);
    }
  }

  async function subirDocumentoCfeActual(e) {
    const archivo = e.target.files?.[0];
    if (!archivo || !proyecto?.cliente_id) return;
    setSubiendoDocCfe(true);
    setErrorCfe(null);
    try {
      await api.subirDocumentoCliente(proyecto.cliente_id, archivo, 'tramite_cfe');
      cargarDocumentosCfe(proyecto.cliente_id);
    } catch (e2) {
      setErrorCfe(e2.message);
    } finally {
      setSubiendoDocCfe(false);
      e.target.value = '';
    }
  }

  function cargarMantenimientos() {
    api.mantenimientosDeProyecto(proyectoId).then((r) => { setMantenimientos(r); setErrorMantenimiento(null); }).catch((e) => setErrorMantenimiento(e.message));
  }

  useEffect(cargarMantenimientos, [proyectoId]);
  useEffect(() => { api.asesores().then(setTecnicos).catch(() => {}); }, []);

  async function crearMantenimientoActual(e) {
    e.preventDefault();
    setCreandoMantenimiento(true);
    setErrorMantenimiento(null);
    try {
      await api.crearMantenimiento(proyectoId, formMantenimiento);
      setFormMantenimiento({ tipo: 'preventivo', tecnicoId: '' });
      cargarMantenimientos();
    } catch (e2) {
      setErrorMantenimiento(e2.message);
    } finally {
      setCreandoMantenimiento(false);
    }
  }

  async function marcarMantenimientoRealizado(mantenimientoId) {
    try {
      await api.actualizarMantenimiento(mantenimientoId, { fecha_realizada: new Date().toISOString().slice(0, 10) });
      cargarMantenimientos();
    } catch (e2) {
      setErrorMantenimiento(e2.message);
    }
  }

  async function programarSiguienteActual(mantenimientoId) {
    const datos = formSiguiente[mantenimientoId];
    if (!datos?.inicio || !datos?.fin) { setErrorMantenimiento('Captura fecha/hora de inicio y fin.'); return; }
    setProgramandoId(mantenimientoId);
    setErrorMantenimiento(null);
    try {
      await api.programarSiguienteMantenimiento(mantenimientoId, new Date(datos.inicio).toISOString(), new Date(datos.fin).toISOString());
      setFormSiguiente({ ...formSiguiente, [mantenimientoId]: undefined });
      cargarMantenimientos();
    } catch (e2) {
      setErrorMantenimiento(e2.message);
    } finally {
      setProgramandoId(null);
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

                <h3>Registrar equipo</h3>
                <form className="config-form-inline" onSubmit={(e) => registrarEquipo(inst.id, e)}>
                  <select value={formEquipo.tipoEquipo} onChange={(e) => setFormEquipo({ ...formEquipo, tipoEquipo: e.target.value })}>
                    <option value="panel">Panel</option>
                    <option value="inversor">Inversor</option>
                    <option value="microinversor">Microinversor</option>
                    <option value="estructura">Estructura</option>
                    <option value="bateria">Batería</option>
                    <option value="otro">Otro</option>
                  </select>
                  <input type="text" placeholder="Marca" value={formEquipo.marca} onChange={(e) => setFormEquipo({ ...formEquipo, marca: e.target.value })} />
                  <input type="text" placeholder="Modelo" value={formEquipo.modelo} onChange={(e) => setFormEquipo({ ...formEquipo, modelo: e.target.value })} />
                  <input type="text" placeholder="Número de serie" value={formEquipo.numeroSerie} onChange={(e) => setFormEquipo({ ...formEquipo, numeroSerie: e.target.value })} />
                  <input type="text" placeholder="Potencia/capacidad (ej. 435W)" value={formEquipo.potenciaCapacidad} onChange={(e) => setFormEquipo({ ...formEquipo, potenciaCapacidad: e.target.value })} />
                  <input type="number" placeholder="Garantía (meses)" value={formEquipo.garantiaMeses} onChange={(e) => setFormEquipo({ ...formEquipo, garantiaMeses: e.target.value })} />
                  <button type="submit" disabled={registrandoEquipo}>{registrandoEquipo ? 'Guardando…' : 'Registrar equipo'}</button>
                </form>
              </div>
            );
          })
        )}
      </section>

      <section className="crm-seccion">
        <h2>Equipos instalados</h2>
        <p className="operaciones-nota">Esto es lo que el cliente verá como "mis paneles/productos" en su portal.</p>
        {errorEquipos && <p className="login-error">{errorEquipos}</p>}
        {equipos === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : equipos.length === 0 ? (
          <p className="operaciones-nota">Todavía no hay equipos registrados para este proyecto.</p>
        ) : (
          <ul className="config-kb-lista">
            {equipos.map((eq) => (
              <li key={eq.id} className="config-kb-item">
                <strong>{eq.tipo_equipo}</strong>{eq.marca ? ` ${eq.marca}` : ''}{eq.modelo ? ` ${eq.modelo}` : ''}
                {eq.numero_serie ? ` — S/N ${eq.numero_serie}` : ''}
                {eq.potencia_capacidad ? ` · ${eq.potencia_capacidad}` : ''}
                {eq.garantia_meses ? ` · Garantía: ${eq.garantia_meses} meses` : ' · Garantía: sin definir'}
                {eq.fecha_instalacion && <span className="operaciones-nota"> — instalado {formatearFecha(eq.fecha_instalacion)}</span>}
                {' · '}<button type="button" className="boton-enlace" onClick={() => verGarantiaDeEquipo(eq.id)}>Ver garantía</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Trámite CFE</h2>
        {errorCfe && <p className="login-error">{errorCfe}</p>}
        {tramiteCfe === undefined ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : tramiteCfe === null ? (
          <>
            <p className="operaciones-nota">Todavía no se ha iniciado el trámite ante CFE para este proyecto.</p>
            <button type="button" onClick={iniciarTramiteCfe} disabled={iniciandoCfe}>{iniciandoCfe ? 'Iniciando…' : 'Iniciar trámite CFE'}</button>
          </>
        ) : (
          <>
            <dl className="crm-datos-lista">
              <dt>Estado</dt>
              <dd>
                <span className={`pill pill--${SEVERIDAD_ESTADO_CFE[tramiteCfe.estado] || 'warning'}`}>{ETIQUETA_ESTADO_CFE[tramiteCfe.estado]}</span>
                {tramiteCfe.alerta && <span className="pill pill--error"> ⚠ {tramiteCfe.dias_sin_actualizacion} días sin actualizar</span>}
              </dd>
              <dt>Folio CFE</dt><dd>{tramiteCfe.folio_cfe || '—'}</dd>
              <dt>Fecha de ingreso</dt><dd>{formatearFecha(tramiteCfe.fecha_ingreso)}</dd>
              <dt>Medidor bidireccional</dt><dd>{tramiteCfe.medidor_bidireccional ? 'Sí' : 'No'}</dd>
              <dt>Notas</dt><dd>{tramiteCfe.notas || '—'}</dd>
            </dl>

            <form className="config-form-inline" onSubmit={(e) => e.preventDefault()}>
              <select onChange={(e) => e.target.value && cambiarEstadoCfe(e.target.value)} value="" disabled={cambiandoEstadoCfe}>
                <option value="">Cambiar estado…</option>
                {ESTADOS_CFE.filter((e) => e !== tramiteCfe.estado).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_CFE[e]}</option>)}
              </select>
              <input type="text" placeholder="Folio CFE" defaultValue={tramiteCfe.folio_cfe || ''} onBlur={(e) => e.target.value !== (tramiteCfe.folio_cfe || '') && guardarCampoCfe('folio_cfe', e.target.value)} />
              <input type="date" defaultValue={tramiteCfe.fecha_ingreso || ''} onChange={(e) => guardarCampoCfe('fecha_ingreso', e.target.value)} />
              <label>
                <input type="checkbox" checked={tramiteCfe.medidor_bidireccional} onChange={(e) => guardarCampoCfe('medidor_bidireccional', e.target.checked)} /> Medidor bidireccional
              </label>
            </form>

            <h3>Documentos del trámite</h3>
            {documentosCfe === null ? (
              <p className="operaciones-nota">Cargando…</p>
            ) : documentosCfe.length === 0 ? (
              <p className="operaciones-nota">Sin documentos subidos todavía (identificación, comprobante de domicilio, contrato de interconexión, dictamen técnico…).</p>
            ) : (
              <ul className="config-kb-lista">
                {documentosCfe.map((d) => (
                  <li key={d.id} className="config-kb-item">
                    <a href={api.urlArchivoDocumentoCliente(d.id)} target="_blank" rel="noreferrer">{d.nombre_archivo || 'Documento'}</a>
                    {' — '}{formatearFechaHora(d.created_at)}
                  </li>
                ))}
              </ul>
            )}
            <input type="file" onChange={subirDocumentoCfeActual} disabled={subiendoDocCfe} />
            {subiendoDocCfe && <span className="operaciones-nota"> Subiendo…</span>}
          </>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Mantenimiento</h2>
        {errorMantenimiento && <p className="login-error">{errorMantenimiento}</p>}
        {mantenimientos === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : mantenimientos.length === 0 ? (
          <p className="operaciones-nota">Todavía no hay mantenimientos registrados.</p>
        ) : (
          <ul className="config-kb-lista">
            {mantenimientos.map((m) => (
              <li key={m.id} className="config-kb-item">
                <span className={`pill pill--${SEVERIDAD_ESTADO_MANTENIMIENTO[m.estado] || 'neutral'}`}>{ETIQUETA_ESTADO_MANTENIMIENTO[m.estado]}</span>
                {' '}<strong>{m.tipo}</strong>{m.tecnico_nombre ? ` — ${m.tecnico_nombre}` : ' — sin técnico asignado'}
                {m.fecha_programada && ` · programado ${formatearFecha(m.fecha_programada)}`}
                {m.fecha_realizada && ` · realizado ${formatearFecha(m.fecha_realizada)}`}
                {m.proximo_mantenimiento && <span className="operaciones-nota"> · siguiente visita ya programada para {formatearFecha(m.proximo_mantenimiento)}</span>}

                {m.estado !== 'realizado' && (
                  <div className="config-form-inline">
                    <button type="button" className="boton-enlace" onClick={() => marcarMantenimientoRealizado(m.id)}>Marcar realizado</button>
                    {!m.proximo_mantenimiento && (
                      <>
                        <input
                          type="datetime-local" placeholder="Inicio siguiente visita"
                          value={formSiguiente[m.id]?.inicio || ''}
                          onChange={(e) => setFormSiguiente({ ...formSiguiente, [m.id]: { ...formSiguiente[m.id], inicio: e.target.value } })}
                        />
                        <input
                          type="datetime-local" placeholder="Fin"
                          value={formSiguiente[m.id]?.fin || ''}
                          onChange={(e) => setFormSiguiente({ ...formSiguiente, [m.id]: { ...formSiguiente[m.id], fin: e.target.value } })}
                        />
                        <button type="button" onClick={() => programarSiguienteActual(m.id)} disabled={programandoId === m.id}>
                          {programandoId === m.id ? 'Programando…' : 'Programar siguiente visita'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3>Nuevo mantenimiento</h3>
        <form className="config-form-inline" onSubmit={crearMantenimientoActual}>
          <select value={formMantenimiento.tipo} onChange={(e) => setFormMantenimiento({ ...formMantenimiento, tipo: e.target.value })}>
            <option value="preventivo">Preventivo</option>
            <option value="correctivo">Correctivo</option>
            <option value="revision_anual">Revisión anual</option>
            <option value="otro">Otro</option>
          </select>
          <select value={formMantenimiento.tecnicoId} onChange={(e) => setFormMantenimiento({ ...formMantenimiento, tecnicoId: e.target.value })}>
            <option value="">— técnico (opcional) —</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <button type="submit" disabled={creandoMantenimiento}>{creandoMantenimiento ? 'Creando…' : 'Crear mantenimiento'}</button>
        </form>
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
            if (paso.clave === 'cfe' && tramiteCfe) {
              const completado = tramiteCfe.estado === 'interconexion_completada';
              return (
                <li key={paso.clave} className="config-kb-item">
                  <span className={`pill pill--${SEVERIDAD_ESTADO_CFE[tramiteCfe.estado] || 'warning'}`}>{completado ? '✓' : '·'}</span>
                  {' '}{paso.etiqueta} — {ETIQUETA_ESTADO_CFE[tramiteCfe.estado]}
                </li>
              );
            }
            if (paso.clave === 'postventa' && mantenimientos?.length > 0) {
              return (
                <li key={paso.clave} className="config-kb-item">
                  <span className="pill pill--success">✓</span> {paso.etiqueta} — {mantenimientos.length} mantenimiento(s) registrado(s)
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
