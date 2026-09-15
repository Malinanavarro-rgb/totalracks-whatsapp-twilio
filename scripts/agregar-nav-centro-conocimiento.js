#!/usr/bin/env node
/**
 * Centro de Conocimiento, Fase 4 — agrega la entrada de navegación
 * "/centro-conocimiento" a:
 *   1. companies.nav_labels.modulos de Nort Energy (gana sobre la plantilla
 *      por cómo modules/auth.js arma ui_config: spread superficial, la
 *      empresa reemplaza el arreglo completo de la plantilla).
 *   2. plantillas_industria.ui_config.modulos de 'paneles_solares' (para
 *      cualquier otra empresa futura de esta industria sin nav_labels propio).
 *
 * Idempotente: si la ruta ya existe en el arreglo, no la duplica.
 *
 * Uso: node scripts/agregar-nav-centro-conocimiento.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const NUEVO_MODULO_NORT = { ruta: '/centro-conocimiento', grupo: 'VENTAS', icono: 'centroConocimiento', etiqueta: 'Centro de Conocimiento', habilitado: true };
const NUEVO_MODULO_PLANTILLA = { ruta: '/centro-conocimiento', icono: 'centroConocimiento', etiqueta: 'Centro de Conocimiento', habilitado: true };

function yaExiste(modulos) {
  return (modulos || []).some((m) => m.ruta === '/centro-conocimiento');
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
    // Se inserta después de "Clientes" (grupo VENTAS), antes de "Cotizaciones".
    const idxClientes = modulosActuales.findIndex((m) => m.ruta === '/crm');
    const nuevos = [...modulosActuales];
    nuevos.splice(idxClientes >= 0 ? idxClientes + 1 : nuevos.length, 0, NUEVO_MODULO_NORT);
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
    const idxCrm = modulosPlantilla.findIndex((m) => m.ruta === '/crm');
    const nuevos = [...modulosPlantilla];
    nuevos.splice(idxCrm >= 0 ? idxCrm + 1 : nuevos.length, 0, NUEVO_MODULO_PLANTILLA);
    const nuevoUiConfig = { ...(plantilla.ui_config || {}), modulos: nuevos };
    const { error } = await supabase.from('plantillas_industria').update({ ui_config: nuevoUiConfig }).eq('slug', 'paneles_solares');
    if (error) throw new Error(error.message);
    console.log('   agregado');
  }

  console.log('\n✅ listo');
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
