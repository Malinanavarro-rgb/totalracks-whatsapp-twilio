/**
 * TARA Matrix™ — Nort Energy: catálogo real de SOLES (Alina, 2026-09-15)
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga la "Ficha Maestra de Proveedor — CORPORATIVO SOLES" que Alina
 * entregó completa en el chat: marca/modelo/potencia/tipo identificados en
 * el catálogo de SOLES. Deliberadamente NO incluye specs eléctricas
 * completas (Voc/Vmp/Isc/rango MPPT/etc.) porque Alina no las dio para
 * estos modelos — "no inventar" (regla de oro de la auditoría). Cada fila
 * queda con `ficha_tecnica_completa: false`: el motor de ingeniería
 * (modules/motores-ingenieria/paneles-solares.js) los descarta
 * automáticamente de cualquier cálculo hasta que se suba la ficha técnica
 * real — ya es el comportamiento existente de ese archivo, no se modifica
 * aquí nada del motor.
 *
 * Exclusivo de Nort Energy (company_id específico) — no toca la plantilla
 * compartida `paneles_solares` ni el catálogo de ninguna otra empresa.
 *
 * Idempotente: si ya existe un producto con el mismo (company_id, marca,
 * modelo), lo actualiza en vez de duplicarlo.
 *
 * Uso: node scripts/nort-energy-catalogo-soles.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy
const PROVEEDOR = 'SOLES';
const FUENTE = 'Ficha Maestra de Proveedor — CORPORATIVO SOLES (Alina, 2026-09-15)';
const FECHA_FUENTE = '2026-09-15';

// ── PANELES SOLARES ─────────────────────────────────────────────────────────
const PANELES = [
  { marca: 'LONGi Solar', modelo: 'LR5-54HTB-435M', potenciaWp: 435, tecnologia: 'Monofacial', descripcion: 'Acabado All Black' },
  { marca: 'LONGi Solar', modelo: 'LR7-72HTH-615M', potenciaWp: 615, tecnologia: 'Monofacial' },
  { marca: 'LUXEN', modelo: 'LNCU-620ND', potenciaWp: 620, tecnologia: 'Monofacial' },
  { marca: 'LUXEN', modelo: 'LNDT-620ND', potenciaWp: 620, tecnologia: 'Bifacial' },
  { marca: 'LUXEN', modelo: 'LNVU-540M', potenciaWp: 540, tecnologia: 'Monofacial' },
  { marca: 'LUXEN', modelo: 'LNVU-580ND', potenciaWp: 580, tecnologia: 'Bifacial' },
  { marca: 'Seraphim', modelo: 'SRP-550-BMA-HV', potenciaWp: 550, tecnologia: 'Monofacial' },
  { marca: 'Seraphim', modelo: 'SRP-610-BTC-BG', potenciaWp: 610, tecnologia: 'Bifacial' },
  { marca: 'TaleSun', modelo: 'TM7G72M', potenciaWp: 590, tecnologia: 'Bifacial' },
];

// ── INVERSORES ───────────────────────────────────────────────────────────────
const INVERSORES = [
  // Huawei SUN2000
  { marca: 'Huawei', modelo: 'SUN2000-20KTL-M3', potenciaAcKw: 20, clasificacion: 'On Grid' },
  { marca: 'Huawei', modelo: 'SUN2000-40KTL-M3', potenciaAcKw: 40, clasificacion: 'On Grid' },
  { marca: 'Huawei', modelo: 'SUN2000-50K-MGL0', potenciaAcKw: 50, clasificacion: 'On Grid' },
  { marca: 'Huawei', modelo: 'SUN2000-100KTL-M2', potenciaAcKw: 100, clasificacion: 'On Grid' },
  // Growatt
  { marca: 'Growatt', modelo: 'MIC 2000TL-X', potenciaAcKw: 2, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MIN 3600TL-X2', potenciaAcKw: 3.6, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MIN 5000TL-X2', potenciaAcKw: 5, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MIN 6000TL-X2', potenciaAcKw: 6, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MIN 10000TL-X2', potenciaAcKw: 10, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MID 15KTL3-XL2', potenciaAcKw: 15, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MID 20KTL3-XL2', potenciaAcKw: 20, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MAX 50KTL3-XL2', potenciaAcKw: 50, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MAX 60KTL3-XL2', potenciaAcKw: 60, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MAX 70KTL3-XL2', potenciaAcKw: 70, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'MAX 75KTL3-XL2', potenciaAcKw: 75, clasificacion: 'On Grid' },
  { marca: 'Growatt', modelo: 'SPH6000TL BL-US', potenciaAcKw: 6, clasificacion: 'Híbrido' },
  { marca: 'Growatt', modelo: 'SPF 3000TL LVM 48P', potenciaAcKw: 3, clasificacion: 'Off Grid' },
  { marca: 'Growatt', modelo: 'SPF 6000T DVM-US MPV', potenciaAcKw: 6, clasificacion: 'Off Grid' },
  // GoodWe
  { marca: 'GoodWe', modelo: 'GW8500-MS', potenciaAcKw: 8.5, clasificacion: 'On Grid' },
  { marca: 'GoodWe', modelo: 'GW15KLV-DT', potenciaAcKw: 15, clasificacion: 'On Grid' },
  // Fronius
  { marca: 'Fronius', modelo: 'SYMO 20.0-3 480', potenciaAcKw: 20, clasificacion: null },
  { marca: 'Fronius', modelo: 'TAURO 50-3-D', potenciaAcKw: 50, clasificacion: 'On Grid' },
  // SMA
  { marca: 'SMA', modelo: 'Sunny Tripower CORE1 62-US', potenciaAcKw: 62, clasificacion: 'On Grid' },
  // Canadian Solar
  { marca: 'Canadian Solar', modelo: 'CSI-50K-T500GL03-E', potenciaAcKw: 50, clasificacion: 'On Grid' },
  { marca: 'Canadian Solar', modelo: 'CSI-80K-T480GL03-U', potenciaAcKw: 80, clasificacion: 'On Grid' },
  { marca: 'Canadian Solar', modelo: 'CSI-100K-T480GL03-U', potenciaAcKw: 100, clasificacion: 'On Grid' },
];

// ── MICROINVERSORES ─────────────────────────────────────────────────────────
const MICROINVERSORES = [
  { marca: 'Enphase', modelo: 'IQ7A-72-2-US', potenciaW: 295, clasificacion: 'On Grid' },
  { marca: 'Enphase', modelo: 'IQ6PLUS-72-2-US', potenciaW: 280, clasificacion: 'On Grid' },
  { marca: 'Hoymiles', modelo: 'MI-1500', potenciaW: 1500, clasificacion: 'On Grid' },
  { marca: 'APsystems', modelo: 'QS1A-NA', potenciaW: 1500, clasificacion: 'On Grid' },
  { marca: 'APsystems', modelo: 'YC600B-X', potenciaW: 750, clasificacion: 'On Grid' },
  { marca: 'APsystems', modelo: 'YC600', potenciaW: 548, clasificacion: 'On Grid' },
];

// ── BATERÍAS Y ALMACENAMIENTO ───────────────────────────────────────────────
const BATERIAS = [
  { marca: 'Huawei', modelo: 'LUNA2000-5-E0', tecnologia: 'Litio', capacidadKwh: 5 },
  { marca: 'Growatt', modelo: 'ARK LV 2.56', tecnologia: 'Litio', capacidadKwh: 2.56 },
];

// ── ESTRUCTURAS Y MATERIAL ELÉCTRICO — a nivel de marca/línea, sin modelo
// específico (SOLES los presenta como familias de accesorios, no como un
// solo modelo con potencia) — se cargan como referencia de catálogo, no
// como componentes calculables por el motor.
const ESTRUCTURAS = [
  { marca: 'K2 Systems', descripcion: 'CrossRail, Micro Rail, Yeti Clamp, End Clamp, Mid Clamp, Rail Connector, Tilt Connector, accesorios para optimizadores/microinversores' },
  { marca: 'Unirac', descripcion: 'L-Foot, PowerMount, Ground Lug, accesorios de anclaje y fijación, tornillería' },
  { marca: 'S-5!', descripcion: 'PVKIT, EdgeGrab, MidGrab, abrazaderas para techos metálicos' },
  { marca: 'Aluminext', descripcion: 'NXT-MOUNT, soluciones de estructura para proyectos fotovoltaicos' },
];

const CABLE = [
  { marca: 'Viakon', descripcion: 'Cable fotovoltaico — calibres identificados: 8, 10, 12 AWG' },
  { marca: 'Sowell', descripcion: 'Cable fotovoltaico — configuraciones hasta 2000V según producto' },
  { marca: 'Leader', descripcion: 'Cable fotovoltaico' },
  { marca: 'Southwire', descripcion: 'Cable fotovoltaico' },
];

function filaBase(marca, modelo, tipo, descripcion) {
  return {
    company_id: COMPANY_ID,
    tipo,
    marca,
    modelo: modelo || null,
    descripcion: descripcion || null,
    proveedor: PROVEEDOR,
    fuente: FUENTE,
    fecha_fuente: FECHA_FUENTE,
    ficha_tecnica_completa: false, // specs eléctricas NO dadas — nunca se inventan
    activo: true,
  };
}

async function upsertProducto(fila) {
  // .eq('modelo', null) nunca matchea en Postgres (NULL != NULL) — para las
  // filas a nivel de marca (estructuras/cable, sin modelo específico) hay
  // que usar .is(), si no cada corrida del script duplicaría esas filas.
  let query = supabase.from('productos').select('*').eq('company_id', COMPANY_ID).eq('marca', fila.marca);
  query = fila.modelo == null ? query.is('modelo', null) : query.eq('modelo', fila.modelo);
  const { data: existente } = await query.maybeSingle();

  if (existente) {
    // Bug real (Alina, 2026-09-15, detectado en la primera corrida): un
    // modelo ya cargado antes con ficha técnica COMPLETA (ej. Huawei
    // SUN2000-40KTL-M3) coincide en marca+modelo con uno de esta lista —
    // un UPDATE ciego habría borrado sus specs reales y bajado
    // ficha_tecnica_completa a false. Nunca degradar un producto que ya
    // tenía mejor información que esta ficha de identificación: solo se
    // actualizan proveedor/fuente/fecha_fuente (trazabilidad), specs se
    // MEZCLA sin pisar claves existentes, y ficha_tecnica_completa nunca
    // baja de true a false.
    const cambios = {
      proveedor: fila.proveedor,
      fuente: existente.fuente || fila.fuente,
      fecha_fuente: existente.fecha_fuente || fila.fecha_fuente,
      descripcion: existente.descripcion || fila.descripcion,
      specs: { ...(fila.specs || {}), ...(existente.specs || {}) }, // existente gana
      ficha_tecnica_completa: existente.ficha_tecnica_completa || fila.ficha_tecnica_completa,
    };
    if (fila.tecnologia) cambios.tecnologia = existente.tecnologia || fila.tecnologia;

    const { error } = await supabase.from('productos').update(cambios).eq('id', existente.id);
    if (error) throw new Error(`update ${fila.marca} ${fila.modelo}: ${error.message}`);
    return 'actualizado (conservando datos existentes)';
  }
  const { error } = await supabase.from('productos').insert([fila]);
  if (error) throw new Error(`insert ${fila.marca} ${fila.modelo}: ${error.message}`);
  return 'creado';
}

(async () => {
  let creados = 0, actualizados = 0;

  for (const p of PANELES) {
    const fila = filaBase(p.marca, p.modelo, 'panel_solar', p.descripcion);
    fila.tecnologia = p.tecnologia;
    fila.specs = { potencia_wp: p.potenciaWp };
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  for (const i of INVERSORES) {
    const fila = filaBase(i.marca, i.modelo, 'inversor', i.clasificacion ? `Clasificación: ${i.clasificacion}` : null);
    fila.specs = { potencia_ac_nominal_kw: i.potenciaAcKw };
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  for (const m of MICROINVERSORES) {
    const fila = filaBase(m.marca, m.modelo, 'microinversor', m.clasificacion ? `Clasificación: ${m.clasificacion}` : null);
    fila.specs = { potencia_w: m.potenciaW };
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  for (const b of BATERIAS) {
    const fila = filaBase(b.marca, b.modelo, 'bateria', null);
    fila.tecnologia = b.tecnologia;
    fila.specs = { capacidad_kwh: b.capacidadKwh };
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  for (const e of ESTRUCTURAS) {
    const fila = filaBase(e.marca, null, 'estructura', e.descripcion);
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  for (const c of CABLE) {
    const fila = filaBase(c.marca, null, 'cableado', c.descripcion);
    const r = await upsertProducto(fila);
    r === 'creado' ? creados++ : actualizados++;
  }

  console.log(`✅ Catálogo SOLES cargado para Nort Energy — ${creados} creados, ${actualizados} actualizados.`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
