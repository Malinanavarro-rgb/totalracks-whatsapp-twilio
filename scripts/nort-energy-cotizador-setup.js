/**
 * TARA Matrix™ — nort-energy-cotizador-setup (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Nort Energy nació solo con la plantilla base de plantillas_industria
 * (paneles_solares): 1 workflow de "visita técnica" (11 nodos), sin el
 * flujo de "Cotización directa — ingeniería solar" (motor de cotizador+PDF)
 * — ese flujo se construyó DIRECTO sobre "Empresa Demo Paneles Solares"
 * (migración 090), nunca se generalizó a la plantilla. Este script replica
 * exactamente esa misma estructura para Nort Energy — MISMO patrón, ya
 * validado en producción — más el catálogo de productos/paquetes que el
 * motor necesita para calcular (irradiacion_regional y parametros_ingenieria
 * son globales por industria, no requieren seed por empresa).
 *
 * Aplica también el fix real encontrado el 2026-08-10 (diagnóstico "mándame
 * la cotización" sin efecto): el motor no requiere area_disponible_m2, así
 * que el nodo final que dispara ejecutar_motor_ingenieria es
 * "preguntar_voltaje" (6 nodos), no "preguntar_area" (7) — la versión
 * corregida desde el día uno, en vez de repetir el bug y corregirlo después.
 *
 * IMPORTANTE — precios de referencia, NO precios reales de Nort Energy: los
 * specs técnicos de panel/inversor son reales (fabricantes reales), pero el
 * precio y el catálogo de paquetes son los mismos números de referencia
 * usados en la demo. Alina debe reemplazarlos por el catálogo/precios reales
 * de Nort Energy antes de operar con anuncios reales — panel de Configuración
 * → Paquetes / Productos.
 *
 * Uso: node scripts/nort-energy-cotizador-setup.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy
const ASESOR_NOMBRE = 'Asesor Nort Energy';

const NODOS_COTIZACION_DIRECTA = [
  { nombre: 'preguntar_ubicacion', es_inicio: true, es_fin: false, pregunta: '¿En qué ciudad o municipio está la instalación?', campo: 'ubicacion', tipo_campo: 'text', es_opcional: false, siguiente_nodo: 'preguntar_consumo_kwh', acciones: [], modo_respuesta: 'prepend_ai', orden: 1 },
  { nombre: 'preguntar_consumo_kwh', es_inicio: false, es_fin: false, pregunta: '¿Cuántos kWh consumes en promedio al mes? Si no lo sabes exacto, dime el monto de tu recibo y lo puedo aproximar.', campo: 'consumo_mensual_kwh', tipo_campo: 'number', es_opcional: false, siguiente_nodo: 'preguntar_importe_recibo', acciones: [], modo_respuesta: 'replace_ai', orden: 2 },
  { nombre: 'preguntar_importe_recibo', es_inicio: false, es_fin: false, pregunta: '¿Cuál es el importe promedio de tu recibo de CFE?', campo: 'importe_promedio_recibo', tipo_campo: 'number', es_opcional: false, siguiente_nodo: 'preguntar_cobertura', acciones: [], modo_respuesta: 'replace_ai', orden: 3 },
  { nombre: 'preguntar_cobertura', es_inicio: false, es_fin: false, pregunta: '¿Qué porcentaje de tu consumo te gustaría cubrir con paneles solares? Si no estás seguro, puedo proponerte 90%.', campo: 'pct_cobertura_deseado', tipo_campo: 'number', es_opcional: false, siguiente_nodo: 'preguntar_tipo_alimentacion', acciones: [], modo_respuesta: 'replace_ai', orden: 4 },
  { nombre: 'preguntar_tipo_alimentacion', es_inicio: false, es_fin: false, pregunta: '¿Tu instalación eléctrica es monofásica, bifásica o trifásica? Si no lo sabes, dime si es casa (normalmente monofásica) o negocio/industria (normalmente trifásica).', campo: 'tipo_alimentacion', tipo_campo: 'text', es_opcional: false, siguiente_nodo: 'preguntar_voltaje', acciones: [], modo_respuesta: 'replace_ai', orden: 5 },
  { nombre: 'preguntar_voltaje', es_inicio: false, es_fin: true, pregunta: '¿Qué voltaje tienes en tu instalación? (220V es lo más común en casas)', campo: 'voltaje_sitio', tipo_campo: 'number', es_opcional: false, siguiente_nodo: null, acciones: [{ tipo: 'ejecutar_motor_ingenieria', parametros: {} }], modo_respuesta: 'replace_ai', orden: 6 },
];

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  // 1. El workflow heredado de la plantilla ("visita técnica") pasa a su
  //    propio trigger — mismo primer paso que migración 090.
  const { data: workflowVisita, error: errLeerWf } = await supabase
    .from('workflows').select('id, trigger_value')
    .eq('company_id', COMPANY_ID).eq('nombre', 'Calificación completa y agenda de visita técnica solar').maybeSingle();
  await fatal('leyendo workflow de visita técnica', errLeerWf);

  if (workflowVisita && workflowVisita.trigger_value !== 'solicitud_visita_tecnica') {
    await fatal('actualizando trigger de visita técnica', (await supabase
      .from('workflows').update({ trigger_value: 'solicitud_visita_tecnica' }).eq('id', workflowVisita.id)).error);
    console.log('✅ Workflow "visita técnica" movido a trigger_value=solicitud_visita_tecnica.');
  } else {
    console.log('⏭️  Workflow de visita técnica ya está en su propio trigger (o no existe).');
  }

  // 2. Workflow nuevo: Cotización directa — ingeniería solar
  const { data: wfExistente } = await supabase
    .from('workflows').select('id').eq('company_id', COMPANY_ID).eq('nombre', 'Cotización directa — ingeniería solar').maybeSingle();

  let workflowId = wfExistente?.id;
  if (!workflowId) {
    const { data: nuevoWf, error: errWf } = await supabase
      .from('workflows')
      .insert([{
        company_id: COMPANY_ID, nombre: 'Cotización directa — ingeniería solar',
        descripcion: 'Captura técnica progresiva para predimensionar el sistema y correr el motor de ingeniería solar sin pasar por una visita técnica previa.',
        trigger: 'intent', trigger_value: 'solicitud_cotizacion', prioridad: 10, activo: true,
      }])
      .select().single();
    await fatal('creando workflow Cotización directa', errWf);
    workflowId = nuevoWf.id;
    console.log(`✅ Workflow "Cotización directa — ingeniería solar" creado (${workflowId}).`);
  } else {
    console.log('⏭️  Workflow "Cotización directa" ya existe.');
  }

  const { data: nodosExistentes } = await supabase.from('workflow_nodes').select('nombre').eq('workflow_id', workflowId);
  const nombresExistentes = new Set((nodosExistentes || []).map(n => n.nombre));
  const nodosFaltantes = NODOS_COTIZACION_DIRECTA.filter(n => !nombresExistentes.has(n.nombre));

  if (nodosFaltantes.length) {
    await fatal('creando nodos de Cotización directa', (await supabase
      .from('workflow_nodes')
      .insert(nodosFaltantes.map(n => ({ ...n, workflow_id: workflowId })))).error);
    console.log(`✅ ${nodosFaltantes.length} nodos creados (6 nodos, dispara ejecutar_motor_ingenieria en "preguntar_voltaje" — sin area_disponible_m2, el motor no la requiere).`);
  } else {
    console.log('⏭️  Nodos de Cotización directa ya existen.');
  }

  // 3. Catálogo de productos (specs reales de fabricante, PRECIO DE
  //    REFERENCIA — pendiente reemplazar con precios reales de Nort Energy).
  const PRODUCTOS = [
    { tipo: 'panel_solar', marca: 'Jinko Solar', modelo: 'Tiger Neo 550', sku: 'JKM550M-72HL4-V', descripcion: 'Panel monocristalino 550W', precio: 3200, unidad: 'pieza', ficha_tecnica_completa: true, activo: true,
      specs: { potencia_wp: 550, voc: 49.5, vmp: 41.7, isc: 14.02, imp: 13.19, coef_temp_voc: -0.27, area_m2: 2.58 } },
    { tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X', sku: 'GW-MIN4000TL-X', descripcion: 'Inversor monofásico 4kW', precio: 9500, unidad: 'pieza', ficha_tecnica_completa: true, activo: true,
      specs: { tipo_red: 'monofasica', voltaje_salida_v: 220, potencia_ac_nominal_kw: 4, potencia_dc_max_kw: 6, voltaje_max_entrada_v: 500, rango_mppt_min_v: 80, rango_mppt_max_v: 450, numero_mppt: 2, corriente_max_por_mppt_a: 13.5 } },
    { tipo: 'inversor', marca: 'Huawei', modelo: 'SUN2000-40KTL-M3', sku: 'HW-SUN2000-40KTL', descripcion: 'Inversor trifásico 40kW', precio: 68000, unidad: 'pieza', ficha_tecnica_completa: true, activo: true,
      specs: { tipo_red: 'trifasica', voltaje_salida_v: 380, potencia_ac_nominal_kw: 40, potencia_dc_max_kw: 60, voltaje_max_entrada_v: 1100, rango_mppt_min_v: 200, rango_mppt_max_v: 1000, numero_mppt: 4, corriente_max_por_mppt_a: 26 } },
  ];

  for (const producto of PRODUCTOS) {
    const { data: existente } = await supabase.from('productos').select('id').eq('company_id', COMPANY_ID).eq('sku', producto.sku).maybeSingle();
    if (existente) { console.log(`⏭️  Producto ${producto.sku} ya existe.`); continue; }
    await fatal(`creando producto ${producto.sku}`, (await supabase.from('productos').insert([{ company_id: COMPANY_ID, ...producto }])).error);
    console.log(`✅ Producto ${producto.sku} creado.`);
  }

  // 4. Paquetes comerciales (PRECIO DE REFERENCIA — mismo catálogo usado en
  //    la demo, pendiente reemplazar con precios reales de Nort Energy).
  const PAQUETES = [
    { nombre: 'Paquete 4 paneles', cantidad_paneles: 4, precio_contado: 34000 },
    { nombre: 'Paquete 6 paneles', cantidad_paneles: 6, precio_contado: 54000 },
    { nombre: 'Paquete 8 paneles', cantidad_paneles: 8, precio_contado: 64000 },
    { nombre: 'Paquete 10 paneles', cantidad_paneles: 10, precio_contado: 84000 },
    { nombre: 'Paquete 12 paneles', cantidad_paneles: 12, precio_contado: 94000 },
  ];

  for (const paquete of PAQUETES) {
    const { data: existente } = await supabase.from('paquetes_solares').select('id').eq('company_id', COMPANY_ID).eq('cantidad_paneles', paquete.cantidad_paneles).maybeSingle();
    if (existente) { console.log(`⏭️  ${paquete.nombre} ya existe.`); continue; }
    await fatal(`creando ${paquete.nombre}`, (await supabase.from('paquetes_solares').insert([{ company_id: COMPANY_ID, ...paquete, activo: true }])).error);
    console.log(`✅ ${paquete.nombre} creado ($${paquete.precio_contado.toLocaleString('es-MX')}).`);
  }

  // 5. Asesor + horario laboral (requiere_agenda=true — visita técnica lo necesita)
  const { data: asesorExistente } = await supabase.from('asesores').select('id').eq('company_id', COMPANY_ID).eq('nombre', ASESOR_NOMBRE).maybeSingle();
  let asesorId = asesorExistente?.id;
  if (!asesorId) {
    const { data: nuevoAsesor, error: errAsesor } = await supabase.from('asesores').insert([{ company_id: COMPANY_ID, nombre: ASESOR_NOMBRE, activo: true }]).select().single();
    await fatal('creando asesor', errAsesor);
    asesorId = nuevoAsesor.id;
    console.log(`✅ Asesor "${ASESOR_NOMBRE}" creado (${asesorId}).`);
  } else {
    console.log('⏭️  Asesor ya existe.');
  }

  const { data: horariosExistentes } = await supabase.from('horarios_laborales').select('dia_semana').eq('company_id', COMPANY_ID).is('asesor_id', null);
  const diasYaConfigurados = new Set((horariosExistentes || []).map(h => h.dia_semana));
  const diasFaltantes = [1, 2, 3, 4, 5, 6].filter(d => !diasYaConfigurados.has(d));
  if (diasFaltantes.length) {
    await fatal('creando horario laboral', (await supabase.from('horarios_laborales').insert(
      diasFaltantes.map(dia => ({ company_id: COMPANY_ID, asesor_id: null, dia_semana: dia, hora_inicio: '08:00', hora_fin: '18:00', zona_horaria: 'America/Monterrey' }))
    )).error);
    console.log('✅ Horario laboral lunes a sábado 08:00–18:00 creado.');
  } else {
    console.log('⏭️  Horario laboral ya existe.');
  }

  console.log(`\n🎉 Nort Energy lista para cotizar de punta a punta (company_id=${COMPANY_ID}).`);
  console.log('⚠️  RECORDATORIO: productos y paquetes usan precios de REFERENCIA — reemplázalos por el catálogo real de Nort Energy antes de operar con anuncios reales (panel de Configuración → Productos/Paquetes).');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en nort-energy-cotizador-setup:', err.message);
  process.exit(1);
});
