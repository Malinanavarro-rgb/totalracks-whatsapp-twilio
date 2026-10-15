import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';
import { formatearMoneda } from '../formato';

// TARA Module Engine, Fase 3.1 (Alina, 2026-10-17) — espacio versionado
// dentro de planes.limites para asignar módulos a cada plan, sin tocar las
// claves ya existentes (api, webhooks, max_usuarios, max_sucursales).
// actualizarPlan() reemplaza la columna `limites` completa (no hace merge
// en el servidor) — por eso SIEMPRE se parte del objeto `limites` ya
// cargado y solo se sustituye la clave `modulos`, nunca se construye uno
// nuevo desde cero.
const MODULOS_SCHEMA_VERSION = 1;

function modulosIncluidos(limites) {
  return limites?.modulos?.incluidos || [];
}

function limitesConModulos(limitesActuales, codigosSeleccionados) {
  return {
    ...(limitesActuales || {}),
    modulos: { schema_version: MODULOS_SCHEMA_VERSION, incluidos: codigosSeleccionados },
  };
}

function SelectorModulos({ catalogo, seleccionados, onCambiar }) {
  const categorias = [...new Set(catalogo.map(m => m.categoria || 'otros'))];
  function alternar(codigo) {
    onCambiar(seleccionados.includes(codigo) ? seleccionados.filter(c => c !== codigo) : [...seleccionados, codigo]);
  }
  return (
    <div className="pm-modulos-selector">
      {categorias.map(cat => (
        <div className="pm-modulos-categoria" key={cat}>
          <span className="pm-modulos-categoria-titulo">{cat}</span>
          <div className="pm-modulos-chips">
            {catalogo.filter(m => (m.categoria || 'otros') === cat).map(m => (
              <label className={`pm-modulo-chip${seleccionados.includes(m.codigo) ? ' pm-modulo-chip--activo' : ''}`} key={m.codigo}>
                <input type="checkbox" checked={seleccionados.includes(m.codigo)} onChange={() => alternar(m.codigo)} />
                {m.nombre}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormularioPlan({ plan, catalogo, onGuardado, onCancelar }) {
  const esNuevo = !plan?.id;
  const [clave, setClave] = useState(plan?.clave || '');
  const [nombre, setNombre] = useState(plan?.nombre || '');
  const [precioCentavos, setPrecioCentavos] = useState(plan?.precio_centavos ?? '');
  const [diasPrueba, setDiasPrueba] = useState(plan?.dias_prueba ?? '');
  const [perksTexto, setPerksTexto] = useState((plan?.perks || []).join('\n'));
  const [maxUsuarios, setMaxUsuarios] = useState(plan?.limites?.max_usuarios ?? '');
  const [maxSucursales, setMaxSucursales] = useState(plan?.limites?.max_sucursales ?? '');
  const [api, setApi] = useState(!!plan?.limites?.api);
  const [webhooks, setWebhooks] = useState(!!plan?.limites?.webhooks);
  const [seleccionados, setSeleccionados] = useState(modulosIncluidos(plan?.limites));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    const limites = {
      ...limitesConModulos(plan?.limites, seleccionados),
      max_usuarios: maxUsuarios === '' ? null : Number(maxUsuarios),
      max_sucursales: maxSucursales === '' ? null : Number(maxSucursales),
      api, webhooks,
    };
    const resumen = esNuevo
      ? `¿Crear el plan "${nombre}" con ${seleccionados.length} módulo(s) incluidos?`
      : `¿Guardar cambios en "${plan.nombre}"? Quedará con ${seleccionados.length} módulo(s) incluidos.`;
    if (!window.confirm(resumen)) return;

    setEnviando(true);
    setError(null);
    try {
      const perks = perksTexto.split('\n').map(p => p.trim()).filter(Boolean);
      if (esNuevo) {
        await adminApi.crearPlan({
          clave, nombre,
          precioCentavos: precioCentavos === '' ? null : Number(precioCentavos),
          diasPrueba: diasPrueba === '' ? null : Number(diasPrueba),
          perks, limites,
        });
      } else {
        await adminApi.actualizarPlan(plan.id, { nombre, perks, limites });
      }
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="pm-form-inline" onSubmit={guardar}>
      {esNuevo && (
        <label>Clave (identificador interno, no se puede cambiar después)
          <input value={clave} onChange={e => setClave(e.target.value)} required placeholder="professional" />
        </label>
      )}
      <label>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} required /></label>
      {esNuevo && (
        <>
          <label>Precio (centavos MXN, vacío = "a la medida")
            <input type="number" value={precioCentavos} onChange={e => setPrecioCentavos(e.target.value)} placeholder="299000" />
          </label>
          <label>Días de prueba (opcional)<input type="number" value={diasPrueba} onChange={e => setDiasPrueba(e.target.value)} /></label>
        </>
      )}
      <label>Beneficios (uno por línea)
        <textarea value={perksTexto} onChange={e => setPerksTexto(e.target.value)} rows={4} />
      </label>

      <div className="pm-modulos-limites-fila">
        <label>Usuarios máx. (vacío = ilimitado)<input type="number" value={maxUsuarios} onChange={e => setMaxUsuarios(e.target.value)} /></label>
        <label>Sucursales máx. (vacío = ilimitado)<input type="number" value={maxSucursales} onChange={e => setMaxSucursales(e.target.value)} /></label>
        <label className="pm-checkbox-linea"><input type="checkbox" checked={api} onChange={e => setApi(e.target.checked)} /> API</label>
        <label className="pm-checkbox-linea"><input type="checkbox" checked={webhooks} onChange={e => setWebhooks(e.target.checked)} /> Webhooks</label>
      </div>

      <span className="pm-modulos-selector-titulo">Módulos incluidos en este plan</span>
      <SelectorModulos catalogo={catalogo} seleccionados={seleccionados} onCambiar={setSeleccionados} />

      {error && <p className="pm-error">{error}</p>}
      <div className="pm-form-acciones">
        <button type="button" className="pm-btn" onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button className="pm-btn pm-btn--primario" disabled={enviando}>{enviando ? 'Guardando…' : esNuevo ? 'Crear plan' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}

export default function Planes() {
  const [planes, setPlanes] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [error, setError] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [creando, setCreando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  function cargar() {
    Promise.all([adminApi.planes(), adminApi.modulosCatalogo()])
      .then(([p, c]) => { setPlanes(p); setCatalogo(c); })
      .catch(e => setError(e.message));
  }

  useEffect(cargar, []);

  function alGuardar(accion) {
    setEditandoId(null);
    setCreando(false);
    setMensaje(accion);
    cargar();
  }

  if (error) return <p className="pm-error">No se pudieron cargar los planes: {error}</p>;
  if (!planes || !catalogo) return <p className="pm-nota">Cargando…</p>;

  return (
    <div>
      <div className="pm-topline">
        <div><h1>Planes</h1><p>Catálogo TARA — editable, sin tocar código</p></div>
        {!creando && <button className="pm-btn pm-btn--primario" onClick={() => setCreando(true)}>+ Nuevo plan</button>}
      </div>

      {mensaje && <p className="pm-exito">Plan {mensaje === 'crear' ? 'creado' : 'actualizado'} correctamente.</p>}

      {creando && (
        <div className="pm-panel" style={{ marginBottom: '1rem', padding: '1.1rem 1.3rem' }}>
          <FormularioPlan catalogo={catalogo} onGuardado={() => alGuardar('crear')} onCancelar={() => setCreando(false)} />
        </div>
      )}

      <div className="pm-plan-grid">
        {planes.map(plan => (
          <div className={`pm-plan-card${plan.clave === 'unlimited' ? ' pm-plan-card--destacado' : ''}${!plan.es_autoservicio ? ' pm-plan-card--enterprise' : ''}${editandoId === plan.id ? ' pm-plan-card--editando' : ''}`} key={plan.id}>
            {editandoId === plan.id ? (
              <FormularioPlan plan={plan} catalogo={catalogo} onGuardado={() => alGuardar('editar')} onCancelar={() => setEditandoId(null)} />
            ) : (
              <>
                <div className="pm-plan-card-head">
                  <b>{plan.nombre}</b>
                  <span className={`pm-pill ${plan.activo ? 'pm-pill--ok' : 'pm-pill--muted'}`}><i />{plan.activo ? 'Activo' : 'Inactivo'}</span>
                </div>
                {plan.precio_centavos == null ? (
                  <div className="pm-plan-precio pm-plan-precio--custom">A la medida</div>
                ) : plan.precio_centavos === 0 ? (
                  <div className="pm-plan-precio">$0<span>/ {plan.dias_prueba} días</span></div>
                ) : (
                  <div className="pm-plan-precio">{formatearMoneda(plan.precio_centavos)}<span>MXN / {plan.periodo}</span></div>
                )}
                <ul className="pm-plan-perks">
                  {(plan.perks || []).map((perk, i) => <li key={i}>{perk}</li>)}
                </ul>
                <p className="pm-nota-inline">
                  {modulosIncluidos(plan.limites).length
                    ? `${modulosIncluidos(plan.limites).length} módulo(s) incluidos`
                    : 'Sin módulos asignados todavía'}
                </p>
                <button className="pm-btn pm-plan-cta" onClick={() => setEditandoId(plan.id)}>Editar</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
