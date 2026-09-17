/**
 * TARA Matrix™ — panel-cotizaciones-paneles-solares (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Panel de Cotizaciones (Alina, 2026-08-10): activa el módulo para la
 * industria paneles_solares — la única que hoy genera cotizaciones reales
 * con el motor de Ingeniería y Cotización (confirmado en la auditoría).
 *
 * Actualiza `plantillas_industria` (slug paneles_solares), no una empresa
 * puntual — a diferencia de scripts/actualizar-plantilla-paneles-solares.js
 * (que corregía workflow_seed, un SNAPSHOT copiado a cada empresa), tanto
 * `dashboard_kpis_seed` como `ui_config.modulos` se leen EN VIVO de esta
 * fila por `company.industria_slug` (ver modules/dashboard.js y
 * modules/auth.js) — un solo UPDATE aquí aplica de inmediato a "Empresa
 * Demo Paneles Solares" y a cualquier empresa paneles_solares futura, sin
 * tocar ninguna fila de `companies`.
 *
 * Cambios:
 *  1. dashboard_kpis_seed: reemplaza el KPI "Cotizaciones enviadas" que
 *     usaba oportunidades.estado='Cotización enviada' (una etapa de
 *     pipeline, no la tabla real) por 3 KPIs sobre `cotizaciones` de
 *     verdad — generadas, enviadas y monto total cotizado del mes.
 *  2. ui_config.modulos: agrega "Cotizaciones" y "Paquetes" al menú.
 *
 * Uso: node scripts/panel-cotizaciones-paneles-solares.js
 * Independiente de migrations/097_cotizaciones_hilo_id.sql — este script
 * solo toca `plantillas_industria` (config), no `cotizaciones`/`companies`.
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const SLUG = 'paneles_solares';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('dashboard_kpis_seed, ui_config').eq('slug', SLUG).single();
  await fatal(`leyendo plantilla ${SLUG}`, errPlantilla);

  // ── 1. dashboard_kpis_seed — quita el proxy, agrega los 3 KPIs reales ────
  const kpisSinProxy = (plantilla.dashboard_kpis_seed?.kpis || [])
    .filter(k => !(k.tipo === 'conteo_oportunidades_por_estado' && k.params?.estado === 'Cotización enviada'));

  const nuevoDashboardKpisSeed = {
    ...plantilla.dashboard_kpis_seed,
    kpis: [
      ...kpisSinProxy,
      { tipo: 'conteo_cotizaciones_por_estado', params: {}, etiqueta: 'Cotizaciones generadas' },
      { tipo: 'conteo_cotizaciones_por_estado', params: { estado: 'enviada' }, etiqueta: 'Cotizaciones enviadas' },
      { tipo: 'suma_cotizaciones_monto', params: { desde: 'mes', formato: 'moneda' }, etiqueta: 'Monto cotizado este mes' },
    ],
  };

  await fatal('actualizando dashboard_kpis_seed', (await supabase
    .from('plantillas_industria').update({ dashboard_kpis_seed: nuevoDashboardKpisSeed }).eq('slug', SLUG)).error);
  console.log(`✅ dashboard_kpis_seed actualizado — ${nuevoDashboardKpisSeed.kpis.length} KPIs (3 nuevos de cotizaciones).`);

  // ── 2. ui_config.modulos — agrega Cotizaciones y Paquetes al menú ───────
  const modulosActuales = plantilla.ui_config?.modulos || [];
  const yaTiene = (ruta) => modulosActuales.some(m => m.ruta === ruta);

  const modulosNuevos = [...modulosActuales];
  const idxConfig = modulosNuevos.findIndex(m => m.ruta === '/configuracion');
  const insertarAntesDeConfig = (modulo) => {
    if (idxConfig === -1) { modulosNuevos.push(modulo); return; }
    modulosNuevos.splice(modulosNuevos.findIndex(m => m.ruta === '/configuracion'), 0, modulo);
  };

  if (!yaTiene('/cotizaciones')) {
    insertarAntesDeConfig({ ruta: '/cotizaciones', icono: 'cotizaciones', etiqueta: 'Cotizaciones', habilitado: true });
  }
  if (!yaTiene('/paquetes')) {
    insertarAntesDeConfig({ ruta: '/paquetes', icono: 'catalogo', etiqueta: 'Paquetes', habilitado: true });
  }

  const nuevoUiConfig = { ...plantilla.ui_config, modulos: modulosNuevos };

  await fatal('actualizando ui_config.modulos', (await supabase
    .from('plantillas_industria').update({ ui_config: nuevoUiConfig }).eq('slug', SLUG)).error);
  console.log(`✅ ui_config.modulos actualizado — ${modulosNuevos.length} módulos en el menú (Cotizaciones y Paquetes agregados).`);

  console.log('\n🎉 Panel de Cotizaciones activo para paneles_solares — "Empresa Demo Paneles Solares" lo ve de inmediato (config en vivo, sin tocar companies).');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en panel-cotizaciones-paneles-solares:', err.message);
  process.exit(1);
});
