import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Quick win (auditoría 2026-09-16, sección N.6): confirmado con certeza que
// no existía NINGUNA pantalla en todo el proyecto que mostrara el catálogo
// técnico real (`productos` — paneles/inversores/baterías con specs y
// proveedor SOLES). `Catalogo.jsx` es el catálogo genérico de `servicios`
// (compartido con salones/uniformes) — este es un archivo nuevo, no una
// modificación de ese, para no tocar el catálogo de otras industrias.
// Campos deliberadamente "customer-safe" — nunca costo_proveedor/costo_
// interno/margen, mismo criterio que catalogo-tecnico.js::sanearProducto().
const TIPOS = ['panel_solar', 'inversor', 'microinversor', 'bateria', 'estructura', 'cableado', 'proteccion', 'accesorio'];
const ETIQUETA_TIPO = {
  panel_solar: 'Panel solar', inversor: 'Inversor', microinversor: 'Microinversor',
  bateria: 'Batería', estructura: 'Estructura', cableado: 'Cable', proteccion: 'Protección', accesorio: 'Accesorio',
};

function specsRelevantes(p) {
  const s = p.specs || {};
  const items = [];
  if (s.potencia_wp) items.push(`${s.potencia_wp} W`);
  if (s.potencia_ac_nominal_kw) items.push(`${s.potencia_ac_nominal_kw} kW AC`);
  if (s.potencia_dc_max_kw) items.push(`${s.potencia_dc_max_kw} kW DC máx.`);
  if (s.tipo_red) items.push(s.tipo_red);
  if (s.capacidad_kwh) items.push(`${s.capacidad_kwh} kWh`);
  return items;
}

export default function CatalogoTecnico() {
  const [productos, setProductos] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');

  useEffect(() => {
    Promise.all(TIPOS.map((t) => api.productosPorTipo(t).catch(() => [])))
      .then((listas) => setProductos(listas.flat()))
      .catch((e) => setError(e.message));
  }, []);

  const filtrados = (productos || []).filter((p) => {
    if (filtroTipo && p.tipo !== filtroTipo) return false;
    if (!busqueda.trim()) return true;
    const texto = `${p.marca || ''} ${p.modelo || ''}`.toLowerCase();
    return texto.includes(busqueda.trim().toLowerCase());
  });

  const tiposConProductos = [...new Set((productos || []).map((p) => p.tipo))];

  return (
    <div>
      <h1>Catálogo técnico</h1>
      <p className="operaciones-nota">Equipo real de proveedor — fichas técnicas confirmadas o pendientes, nunca inventadas.</p>

      <div className="config-form-inline">
        <input
          type="text" placeholder="Buscar por marca o modelo…"
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
        />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {tiposConProductos.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t] || t}</option>)}
        </select>
      </div>

      {error && <p className="login-error">{error}</p>}
      {productos === null && !error && <p className="operaciones-nota">Cargando…</p>}
      {productos?.length === 0 && <p className="operaciones-nota">Sin productos en el catálogo todavía.</p>}
      {productos && productos.length > 0 && filtrados.length === 0 && <p className="operaciones-nota">Sin resultados con ese filtro.</p>}

      <div className="catalogo-tecnico-grid">
        {filtrados.map((p) => (
          <div key={p.id} className="catalogo-tecnico-tarjeta">
            <div className="catalogo-tecnico-tipo">{ETIQUETA_TIPO[p.tipo] || p.tipo}</div>
            <div className="catalogo-tecnico-marca">{p.marca || 'Marca no especificada'}</div>
            <div className="catalogo-tecnico-modelo">{p.modelo || 'Modelo no especificado'}</div>

            {specsRelevantes(p).length > 0 && (
              <p className="operaciones-nota">{specsRelevantes(p).join(' · ')}</p>
            )}

            <dl className="crm-datos-lista">
              {p.tecnologia && (<><dt>Tecnología</dt><dd>{p.tecnologia}</dd></>)}
              {p.garantia_meses != null && (<><dt>Garantía</dt><dd>{(p.garantia_meses / 12).toFixed(1)} años</dd></>)}
              {p.proveedor && (<><dt>Proveedor</dt><dd>{p.proveedor}</dd></>)}
              {p.estatus_disponibilidad && (<><dt>Disponibilidad</dt><dd>{p.estatus_disponibilidad}</dd></>)}
            </dl>

            <span className={`pill pill--${p.ficha_tecnica_completa ? 'success' : 'warning'}`}>
              {p.ficha_tecnica_completa ? 'Ficha técnica confirmada' : 'Ficha técnica pendiente de confirmar'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
