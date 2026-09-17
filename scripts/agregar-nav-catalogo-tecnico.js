#!/usr/bin/env node
/**
 * Quick win (auditoría 2026-09-16, sección N.6) — agrega la entrada de
 * navegación "/catalogo-tecnico" a Nort Energy (nav_labels) y a la
 * plantilla paneles_solares (para GONDOR/Empresa Demo también) — mismo
 * patrón exacto que scripts/agregar-nav-centro-conocimiento.js.
 *
 * Idempotente: si la ruta ya existe en el arreglo, no la duplica.
 *
 * Uso: node scripts/agregar-nav-catalogo-tecnico.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const NUEVO_MODULO_NORT = { ruta: '/catalogo-tecnico', grupo: 'VENTAS', icono: 'catalogo', etiqueta: 'Catálogo técnico', habilitado: true };
const NUEVO_MODULO_PLANTILLA = { ruta: '/catalogo-tecnico', icono: 'catalogo', etiqueta: 'Catálogo técnico', habilitado: true };

function yaExiste(modulos) {
  return (modulos || []).some((m) => m.ruta === '/catalogo-tecnico');
}

async function main() {
  console.log('1) companies.nav_labels de Nort Energy');
  const { data: empresa, error: errEmpresa } = await supabase.from('companies').select('id, nombre, nav_labels').ilike('nombre', '%Nort Energy%').maybeSingle();
  if (errEmpresa) throw new Error(errEmpresa.message);
  if (!empresa) throw new Error('No se encontró Nort Energy');

  const modulosActuales = empresa.nav_labels?.modulos || [];
  if (yaExiste(modulosActuales)) {
    console.log('   ya existe — no se duplica');
  } else {
    const idxCatalogo = modulosActuales.findIndex((m) => m.ruta === '/catalogo');
    const nuevos = [...modulosActuales];
    nuevos.splice(idxCatalogo >= 0 ? idxCatalogo + 1 : nuevos.length, 0, NUEVO_MODULO_NORT);
    const nuevoNavLabels = { ...(empresa.nav_labels || {}), modulos: nuevos };
    const { error } = await supabase.from('companies').update({ nav_labels: nuevoNavLabels }).eq('id', empresa.id);
    if (error) throw new Error(error.message);
    console.log('   agregado');
  }

  console.log('\n2) plantillas_industria (paneles_solares).ui_config.modulos');
  const { data: plantilla, error: errPlantilla } = await supabase.from('plantillas_industria').select('slug, ui_config').eq('slug', 'paneles_solares').maybeSingle();
  if (errPlantilla) throw new Error(errPlantilla.message);
  if (!plantilla) throw new Error('No se encontró la plantilla paneles_solares');

  const modulosPlantilla = plantilla.ui_config?.modulos || [];
  if (yaExiste(modulosPlantilla)) {
    console.log('   ya existe — no se duplica');
  } else {
    const idxCatalogo = modulosPlantilla.findIndex((m) => m.ruta === '/catalogo');
    const nuevos = [...modulosPlantilla];
    nuevos.splice(idxCatalogo >= 0 ? idxCatalogo + 1 : nuevos.length, 0, NUEVO_MODULO_PLANTILLA);
    const nuevoUiConfig = { ...(plantilla.ui_config || {}), modulos: nuevos };
    const { error } = await supabase.from('plantillas_industria').update({ ui_config: nuevoUiConfig }).eq('slug', 'paneles_solares');
    if (error) throw new Error(error.message);
    console.log('   agregado');
  }

  console.log('\n✅ listo');
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
