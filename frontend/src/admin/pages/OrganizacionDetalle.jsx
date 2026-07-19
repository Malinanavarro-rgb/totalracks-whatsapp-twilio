import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../adminApi';
import { formatearMoneda, formatearFecha, ESTADO_ETIQUETA, ESTADO_CLASE } from '../formato';

const TABS = [
  { id: 'resumen', etiqueta: 'Resumen' },
  { id: 'suscripcion', etiqueta: 'Suscripción' },
  { id: 'metodo-pago', etiqueta: 'Método de pago' },
  { id: 'licencias', etiqueta: 'Licencias' },
  { id: 'auditoria', etiqueta: 'Auditoría' },
];

export default function OrganizacionDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [planes, setPlanes] = useState([]);
  const [metodoPago, setMetodoPago] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [auditoria, setAuditoria] = useState([]);
  const [tab, setTab] = useState('resumen');
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const cargarTodo = useCallback(async () => {
    try {
      const [orgData, planesData, metodoData, pagosData, auditData] = await Promise.all([
        adminApi.organizacion(id),
        adminApi.planes(),
        adminApi.metodoPago(id).catch(() => null),
        adminApi.pagos(id).catch(() => []),
        adminApi.auditLog(id).catch(() => []),
      ]);
      setOrg(orgData);
      setPlanes(planesData);
      setMetodoPago(metodoData);
      setPagos(pagosData);
      setAuditoria(auditData);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  async function accion(fn, textoExito) {
    setMensaje(null);
    setError(null);
    try {
      await fn();
      setMensaje(textoExito);
      await cargarTodo();
    } catch (e) {
      setError(e.message);
    }
  }

  async function entrarComoAdmin() {
    const company = org.companies?.[0];
    if (!company) return;
    const motivo = window.prompt('¿Motivo de la sesión de soporte? (opcional)') || undefined;
    await adminApi.impersonar(company.id, motivo);
    window.location.href = '/operaciones';
  }

  if (error && !org) return <p className="pm-error">No se pudo cargar la organización: {error}</p>;
  if (!org) return <p className="pm-nota">Cargando…</p>;

  const company = org.companies?.[0];
  const sub = org.suscripcionVigente;

  return (
    <div>
      <button className="pm-back" onClick={() => navigate('/admin/organizaciones')}>← Organizaciones</button>

      <div className="pm-detalle-head">
        <div className="pm-detalle-id">
          <span className="pm-org-avatar pm-org-avatar--grande">{(org.nombre || '?').charAt(0).toUpperCase()}</span>
          <div>
            <h1>{org.nombre}</h1>
            <p>{company?.industria_slug || 'Sin giro'} · alta {formatearFecha(org.created_at)}</p>
          </div>
        </div>
        <div className="pm-detalle-acciones">
          <button className="pm-btn" onClick={entrarComoAdmin}>🔑 Entrar como administrador</button>
          {org.estado === 'activa' ? (
            <button className="pm-btn pm-btn--peligro" onClick={() => accion(() => adminApi.suspenderOrganizacion(id), 'Empresa suspendida.')}>Suspender empresa</button>
          ) : (
            <button className="pm-btn" onClick={() => accion(() => adminApi.reactivarOrganizacion(id), 'Empresa reactivada.')}>Reactivar empresa</button>
          )}
        </div>
      </div>

      {mensaje && <p className="pm-exito">{mensaje}</p>}
      {error && <p className="pm-error">{error}</p>}

      <div className="pm-tabs">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'pm-activo' : ''} onClick={() => setTab(t.id)}>{t.etiqueta}</button>
        ))}
      </div>

      {tab === 'resumen' && (
        <div className="pm-grid-2">
          <div className="pm-panel">
            <div className="pm-panel-head"><h2>Estado</h2></div>
            <div className="pm-campo-lista">
              <div className="pm-campo-fila"><span className="l">Estado operativo</span><span className={`pm-pill ${org.estado === 'activa' ? 'pm-pill--ok' : 'pm-pill--danger'}`}><i />{org.estado === 'activa' ? 'Activa' : 'Suspendida'}</span></div>
              <div className="pm-campo-fila"><span className="l">Estado de suscripción</span>
                {sub ? <span className={`pm-pill ${ESTADO_CLASE[sub.estado]}`}><i />{ESTADO_ETIQUETA[sub.estado]}</span> : <span className="pm-nota-inline">Sin suscripción</span>}
              </div>
              <div className="pm-campo-fila"><span className="l">Plan contratado</span><span className="v">{sub?.planes?.nombre || '—'}</span></div>
              <div className="pm-campo-fila"><span className="l">Fecha de alta</span><span className="v">{formatearFecha(org.created_at)}</span></div>
            </div>
          </div>
          <div className="pm-panel">
            <div className="pm-panel-head"><h2>Empresa</h2></div>
            <div className="pm-campo-lista">
              <div className="pm-campo-fila"><span className="l">Nombre</span><span className="v">{company?.nombre}</span></div>
              <div className="pm-campo-fila"><span className="l">Giro</span><span className="v">{company?.industria_slug || '—'}</span></div>
              <div className="pm-campo-fila"><span className="l">Estado (tráfico WhatsApp)</span><span className="v">{company?.estado}</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'suscripcion' && (
        <div className="pm-grid-2">
          <div className="pm-panel">
            <div className="pm-panel-head"><h2>Historial de pagos</h2><span className="n">{pagos.length} factura(s)</span></div>
            <div className="pm-panel-body" style={{ overflowX: 'auto' }}>
              {pagos.length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin pagos registrados todavía.</p>}
              {pagos.length > 0 && (
                <table>
                  <thead><tr><th>Folio</th><th>Fecha</th><th>Subtotal</th><th>IVA</th><th>Total</th><th>Estado</th><th>Factura</th></tr></thead>
                  <tbody>
                    {pagos.map(p => (
                      <tr key={p.id}>
                        <td className="tabular">{p.numero_factura || '—'}</td>
                        <td className="tabular">{formatearFecha(p.fecha_emision)}</td>
                        <td className="tabular">{formatearMoneda(p.subtotal_centavos, { decimales: true })}</td>
                        <td className="tabular">{formatearMoneda(p.iva_centavos, { decimales: true })}</td>
                        <td className="tabular"><b>{formatearMoneda(p.total_centavos, { decimales: true })}</b></td>
                        <td><span className={`pm-pill ${p.estado === 'paid' ? 'pm-pill--ok' : 'pm-pill--muted'}`}><i />{p.estado}</span></td>
                        <td>
                          {p.factura_pdf_url ? <a href={p.factura_pdf_url} target="_blank" rel="noreferrer">PDF</a> : '—'}
                          {' · '}
                          {p.factura_xml_url ? <a href={p.factura_xml_url} target="_blank" rel="noreferrer">XML</a> : <span className="pm-nota-inline">XML —</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="pm-panel">
            <div className="pm-panel-head"><h2>Plan &amp; cobro</h2></div>
            {sub ? (
              <div className="pm-campo-lista">
                <div className="pm-campo-fila"><span className="l">Plan</span><span className="v">{sub.planes?.nombre}{sub.planes?.precio_centavos != null ? ` — ${formatearMoneda(sub.planes.precio_centavos)}/mes` : ''}</span></div>
                <div className="pm-campo-fila"><span className="l">Inicio</span><span className="v">{formatearFecha(sub.fecha_inicio)}</span></div>
                <div className="pm-campo-fila"><span className="l">Próximo cobro</span><span className="v">{formatearFecha(sub.fecha_periodo_actual_fin)}</span></div>
                <div className="pm-campo-fila"><span className="l">Fin de prueba</span><span className="v">{formatearFecha(sub.fecha_prueba_fin)}</span></div>
                <div className="pm-campo-fila"><span className="l">Renovación automática</span><span className="v">{sub.cancelar_al_fin_periodo ? 'No — se cancela al fin de periodo' : 'Sí'}</span></div>
                <div className="pm-campo-fila"><span className="l">Meses de regalo</span><span className="v">{sub.meses_regalo}</span></div>
                <div className="pm-campo-fila"><span className="l">Proveedor</span><span className="v">{sub.proveedor}</span></div>
              </div>
            ) : (
              <FormularioNuevaSuscripcion organizationId={id} planes={planes} onCreada={() => accion(() => Promise.resolve(), 'Suscripción creada.')} />
            )}
          </div>
        </div>
      )}

      {tab === 'metodo-pago' && (
        <div className="pm-panel" style={{ maxWidth: 420 }}>
          <div className="pm-panel-head"><h2>Método de pago</h2></div>
          <div className="pm-panel-body">
            {metodoPago ? (
              <div className="pm-tarjeta-guardada">
                <div className="pm-tarjeta-marca">{(metodoPago.marca || '').toUpperCase()}</div>
                <div className="pm-tarjeta-numero">•••• •••• •••• {metodoPago.ultimos4 || '····'}</div>
                <div className="pm-tarjeta-exp">Expira {metodoPago.fecha_expiracion || '—'}</div>
              </div>
            ) : (
              <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin método de pago registrado.</p>
            )}
            <div style={{ padding: '0 1.15rem 1.1rem' }}>
              <FormularioMetodoPago organizationId={id} onGuardado={() => accion(() => Promise.resolve(), 'Método de pago actualizado.')} />
            </div>
          </div>
        </div>
      )}

      {tab === 'licencias' && (
        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Licencias y acciones</h2></div>
          {sub ? (
            <FormulariosLicencias suscripcion={sub} planes={planes} onAccion={accion} />
          ) : (
            <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Esta organización todavía no tiene una suscripción — créala en la pestaña "Suscripción" primero.</p>
          )}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="pm-panel">
          <div className="pm-panel-head"><h2>Actividad de plataforma</h2><span className="n">esta organización</span></div>
          <div className="pm-panel-body">
            {auditoria.length === 0 && <p className="pm-nota" style={{ padding: '0 1.15rem 1rem' }}>Sin eventos todavía.</p>}
            {auditoria.map(e => (
              <div className="pm-audit-fila" key={e.id}>
                <span className="pm-audit-dot" />
                <span>{e.accion.replaceAll('_', ' ')}</span>
                <span className="pm-cuando">{new Date(e.created_at).toLocaleString('es-MX')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormularioNuevaSuscripcion({ organizationId, planes, onCreada }) {
  const [planId, setPlanId] = useState(planes[0]?.id || '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await adminApi.crearSuscripcion({ organizationId, planId });
      onCreada();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="pm-form-inline" onSubmit={guardar} style={{ padding: '0 1.15rem 1.1rem' }}>
      <p className="pm-nota" style={{ margin: '0 0 0.7rem' }}>Esta organización no tiene plan asignado todavía.</p>
      <label>Plan
        <select value={planId} onChange={e => setPlanId(e.target.value)} required>
          {planes.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      {error && <p className="pm-error">{error}</p>}
      <button className="pm-btn pm-btn--primario" disabled={enviando}>{enviando ? 'Creando…' : 'Asignar plan'}</button>
    </form>
  );
}

function FormularioMetodoPago({ organizationId, onGuardado }) {
  const [proveedor, setProveedor] = useState('stripe');
  const [token, setToken] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [marca, setMarca] = useState('');
  const [fechaExpiracion, setFechaExpiracion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await adminApi.actualizarMetodoPago(organizationId, { proveedor, token, ultimos4, marca, fechaExpiracion });
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="pm-form-inline" onSubmit={guardar}>
      <label>Proveedor
        <select value={proveedor} onChange={e => setProveedor(e.target.value)}>
          <option value="stripe">Stripe</option>
          <option value="mercadopago">Mercado Pago</option>
          <option value="openpay">OpenPay</option>
        </select>
      </label>
      <label>Token del método de pago<input value={token} onChange={e => setToken(e.target.value)} required placeholder="tok_..." /></label>
      <label>Marca<input value={marca} onChange={e => setMarca(e.target.value)} placeholder="Visa" /></label>
      <label>Últimos 4 dígitos<input value={ultimos4} onChange={e => setUltimos4(e.target.value)} maxLength={4} placeholder="4242" /></label>
      <label>Expiración<input value={fechaExpiracion} onChange={e => setFechaExpiracion(e.target.value)} placeholder="MM/YY" /></label>
      {error && <p className="pm-error">{error}</p>}
      <button className="pm-btn" disabled={enviando} style={{ width: '100%', justifyContent: 'center' }}>
        {enviando ? 'Guardando…' : 'Actualizar método de pago'}
      </button>
    </form>
  );
}

function FormulariosLicencias({ suscripcion, planes, onAccion }) {
  const [planId, setPlanId] = useState(suscripcion.plan_id);
  const [dias, setDias] = useState(7);
  const [meses, setMeses] = useState(1);

  return (
    <div className="pm-panel-body">
      <div className="pm-accion-fila">
        <div className="pm-txt"><b>Cambiar plan</b><span>Se aplica de inmediato</span></div>
        <div className="pm-accion-control">
          <select value={planId} onChange={e => setPlanId(e.target.value)}>
            {planes.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button className="pm-btn pm-btn--chico" onClick={() => onAccion(() => adminApi.cambiarPlanSuscripcion(suscripcion.id, planId), 'Plan actualizado.')}>Cambiar</button>
        </div>
      </div>
      <div className="pm-accion-fila">
        <div className="pm-txt"><b>Extender periodo de prueba</b><span>Agrega días a fecha_prueba_fin</span></div>
        <div className="pm-accion-control">
          <input type="number" min="1" value={dias} onChange={e => setDias(Number(e.target.value))} style={{ width: 70 }} />
          <button className="pm-btn pm-btn--chico" onClick={() => onAccion(() => adminApi.extenderPrueba(suscripcion.id, dias), `Prueba extendida ${dias} día(s).`)}>Extender</button>
        </div>
      </div>
      <div className="pm-accion-fila">
        <div className="pm-txt"><b>Regalar meses</b><span>Extiende el próximo cobro sin afectar el precio</span></div>
        <div className="pm-accion-control">
          <input type="number" min="1" value={meses} onChange={e => setMeses(Number(e.target.value))} style={{ width: 70 }} />
          <button className="pm-btn pm-btn--chico" onClick={() => onAccion(() => adminApi.regalarMeses(suscripcion.id, meses), `${meses} mes(es) de regalo aplicados.`)}>Regalar</button>
        </div>
      </div>
    </div>
  );
}
