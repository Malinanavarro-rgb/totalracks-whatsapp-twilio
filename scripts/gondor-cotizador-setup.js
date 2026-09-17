/**
 * TARA Matrix™ — gondor-cotizador-setup (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replica para GONDOR el mismo patrón validado en producción con Nort Energy
 * (scripts/nort-energy-cotizador-setup.js): mueve el workflow de "visita
 * técnica" heredado de la plantilla paneles_solares a su propio trigger, y
 * agrega el flujo "Cotización directa — ingeniería solar" (6 nodos, captura
 * ubicación → consumo kWh → importe de recibo CFE → % cobertura deseado →
 * tipo de alimentación → voltaje, dispara ejecutar_motor_ingenieria en el
 * último nodo — el motor no requiere area_disponible_m2).
 *
 * IMPORTANTE — precios de referencia, NO precios reales de GONDOR: mismo
 * catálogo/specs de fabricante y mismos precios placeholder que se usaron
 * para Nort Energy (decisión explícita de Alina: "usa precios de referencia
 * por ahora"). Reemplazar por el catálogo/precios reales de GONDOR antes de
 * operar con anuncios reales — panel de Configuración → Paquetes/Productos.
 *
 * Uso: node scripts/gondor-cotizador-setup.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = 'f0fd3f2b-18e6-4621-aeb0-974c6ef40a56'; // GONDOR
const ASESOR_NOMBRE = 'Asesor GONDOR';

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
  //    propio trigger — libera "solicitud_cotizacion" para el flujo nuevo.
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
    console.log(`✅ ${nodosFaltantes.length} nodos creados (6 nodos, dispara ejecutar_motor_ingenieria en "preguntar_voltaje").`);
  } else {
    console.log('⏭️  Nodos de Cotización directa ya existen.');
  }

  // 3. Catálogo de productos (specs reales de fabricante, PRECIO DE
  //    REFERENCIA — mismo catálogo usado en Nort Energy, pendiente
  //    reemplazar con precios reales de GONDOR).
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
  //    Nort Energy, pendiente reemplazar con precios reales de GONDOR).
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

  // 5. Asesor + horario laboral (requiere_agenda=true — visita técnica lo
  //    necesita). Horario real de GONDOR: Lun–Sáb 8:00–19:00.
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
      diasFaltantes.map(dia => ({ company_id: COMPANY_ID, asesor_id: null, dia_semana: dia, hora_inicio: '08:00', hora_fin: '19:00', zona_horaria: 'America/Monterrey' }))
    )).error);
    console.log('✅ Horario laboral lunes a sábado 08:00–19:00 creado (horario real de GONDOR).');
  } else {
    console.log('⏭️  Horario laboral ya existe.');
  }

  console.log(`\n🎉 GONDOR lista para cotizar paneles solares de punta a punta (company_id=${COMPANY_ID}).`);
  console.log('⚠️  RECORDATORIO: productos y paquetes usan precios de REFERENCIA (mismos que Nort Energy) — reemplázalos por el catálogo real de GONDOR antes de operar con anuncios reales (panel de Configuración → Productos/Paquetes).');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en gondor-cotizador-setup:', err.message);
  process.exit(1);
});
