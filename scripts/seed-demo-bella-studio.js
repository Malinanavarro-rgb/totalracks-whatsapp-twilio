/**
 * TARA Matrix™ — seed-demo-bella-studio (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Termina de dejar lista la empresa demo "Bella Studio Salón & Spa"
 * (creada vía scripts/crear-empresa.js, company_id ver COMPANY_ID abajo) para
 * que una vendedora la use en demos en vivo con prospectos reales.
 *
 * También corrige, en la FUENTE (`plantillas_industria`, slug=salon_belleza),
 * dos bugs reales que esta empresa habría heredado igual que Sugar Salon:
 *
 * 1. trigger_value='solicitud_cotizacion' — mismo bug que
 *    migrations/061_fix_trigger_agendar_sugar_salon.sql: la IA clasifica un
 *    agendado de salón (precios fijos, sin negociación) como 'interes_compra',
 *    nunca como 'solicitud_cotizacion'. Sin este fix el workflow jamás se
 *    activa y TARA "confirma" citas de palabra sin crear la fila real.
 *
 * 2. personalities.reglas como array de strings planos — context-builder.js
 *    espera objetos {texto, etapas}; con strings, `r.texto` es undefined y la
 *    regla se descarta en silencio (nunca llega al prompt real).
 *
 * Uso: node scripts/seed-demo-bella-studio.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = 'ce1d7f89-c175-434b-9634-386fc7b59322';
const ASESORA_NOMBRE = 'Ana';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  // 1. Fix en la FUENTE — plantillas_industria.salon_belleza ------------------
  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('id, workflow_seed, personalidad').eq('slug', 'salon_belleza').single();
  await fatal('leyendo plantilla salon_belleza', errPlantilla);

  const workflowSeedFix = { ...plantilla.workflow_seed, trigger_value: 'interes_compra' };
  const personalidadFix = {
    ...plantilla.personalidad,
    reglas: [
      { texto: 'Si la clienta agenda un servicio, sugiere amablemente un servicio complementario (ej. ofrece pedicure si pidió manicure, o viceversa).', etapas: [] },
    ],
  };

  await fatal('corrigiendo plantilla salon_belleza', (await supabase
    .from('plantillas_industria')
    .update({ workflow_seed: workflowSeedFix, personalidad: personalidadFix })
    .eq('id', plantilla.id)).error);
  console.log('✅ Plantilla salon_belleza corregida (trigger_value + formato de reglas) — futuras empresas ya no heredan estos bugs.');

  // 2. Fix del workflow YA creado para Bella Studio (copió el bug) -----------
  await fatal('corrigiendo workflow de Bella Studio', (await supabase
    .from('workflows')
    .update({ trigger_value: 'interes_compra' })
    .eq('company_id', COMPANY_ID)
    .eq('trigger_value', 'solicitud_cotizacion')).error);
  console.log('✅ Workflow "Agendar servicio de salón" de Bella Studio: trigger corregido a interes_compra.');

  // 3. Reglas correctas + regla nueva de upsell (no afecta duracion_minutos) --
  await fatal('actualizando reglas de personalidad', (await supabase
    .from('personalities')
    .update({
      reglas: [
        { texto: 'Si la clienta agenda un servicio, sugiere amablemente un servicio complementario (ej. ofrece pedicure si pidió manicure, o viceversa).', etapas: [] },
        { texto: 'No menciones precios de forma proactiva. Comparte el costo de un servicio únicamente si la clienta pregunta directamente por el precio.', etapas: [] },
        { texto: 'Justo después de confirmar una cita (nunca antes), ofrece en una sola frase breve una promoción vigente relacionada con el servicio agendado — por ejemplo: "Ya agendé tu cita de manicure con Ana. Aprovecha que tenemos una promoción de $100 en tratamiento de proteína o mascarilla anti-callos, ¿te gustaría agregarlo?". Es una sugerencia de una sola vez, nunca insistas si la clienta no responde o dice que no. Esta promoción es un cargo adicional en el mismo servicio: nunca cambia la hora ni la duración ya agendada de la cita.', etapas: [] },
        { texto: 'Nunca repitas una pregunta o confirmación que ya hiciste en la conversación. Sé precisa y objetiva: confirma datos concretos (servicio, día, hora) sin relleno ni frases genéricas de "asistente virtual". Nunca menciones que eres una inteligencia artificial ni uses ese lenguaje.', etapas: [] },
      ],
    })
    .eq('company_id', COMPANY_ID)).error);
  console.log('✅ Reglas de personalidad actualizadas (formato correcto + upsell + calidad conversacional).');

  // 4. Asesora + horario laboral (sin esto, Agenda queda 100% rota) ----------
  const { data: asesoraExistente } = await supabase
    .from('asesores').select('id').eq('company_id', COMPANY_ID).eq('nombre', ASESORA_NOMBRE).maybeSingle();

  let asesoraId = asesoraExistente?.id;
  if (!asesoraId) {
    const { data: asesora, error: errAsesora } = await supabase
      .from('asesores').insert([{ company_id: COMPANY_ID, nombre: ASESORA_NOMBRE, activo: true }]).select().single();
    await fatal('creando asesora', errAsesora);
    asesoraId = asesora.id;
  }
  console.log(`✅ Asesora "${ASESORA_NOMBRE}" lista (${asesoraId}).`);

  const { data: horariosExistentes } = await supabase
    .from('horarios_laborales').select('dia_semana').eq('company_id', COMPANY_ID).is('asesor_id', null);
  const diasYaConfigurados = new Set((horariosExistentes || []).map(h => h.dia_semana));
  const diasFaltantes = [1, 2, 3, 4, 5, 6].filter(d => !diasYaConfigurados.has(d));
  if (diasFaltantes.length) {
    await fatal('creando horarios laborales', (await supabase
      .from('horarios_laborales')
      .insert(diasFaltantes.map(dia => ({
        company_id: COMPANY_ID, asesor_id: null, dia_semana: dia,
        hora_inicio: '09:00', hora_fin: '19:00', zona_horaria: 'America/Monterrey',
      })))).error);
  }
  console.log('✅ Horario laboral lunes a sábado 09:00–19:00 (domingo cerrado).');

  // 5. Clientas demo realistas ------------------------------------------------
  const clientasSeed = [
    { nombre: 'Karla Torres',    telefono: '+5218112345801', estado: 'Cita agendada', score_interes: 78 },
    { nombre: 'Valeria Cruz',    telefono: '+5218112345802', estado: 'Cita agendada', score_interes: 82 },
    { nombre: 'Fernanda López',  telefono: '+5218112345803', estado: 'Recurrente',    score_interes: 88 },
    { nombre: 'Daniela Ramírez', telefono: '+5218112345804', estado: 'Atendido',      score_interes: 60 },
    { nombre: 'Sofía Hernández', telefono: '+5218112345805', estado: 'Nuevo',         score_interes: 35 },
  ];

  const clientesPorNombre = {};
  for (const c of clientasSeed) {
    const { data: existente } = await supabase
      .from('clientes').select('id').eq('company_id', COMPANY_ID).eq('telefono', c.telefono).maybeSingle();
    if (existente) { clientesPorNombre[c.nombre] = existente.id; continue; }

    const { data: nuevo, error: errCliente } = await supabase
      .from('clientes')
      .insert([{ company_id: COMPANY_ID, nombre: c.nombre, telefono: c.telefono, ciudad: 'Monterrey', fuente: 'WhatsApp', estado: c.estado, score_interes: c.score_interes }])
      .select().single();
    await fatal(`creando clienta ${c.nombre}`, errCliente);
    clientesPorNombre[c.nombre] = nuevo.id;
  }
  console.log('✅ 5 clientas demo listas.');

  // 6. Citas demo — una futura sin confirmar (vive en la Agenda hoy mismo),
  //    una futura confirmada, e historial para que se vea una empresa real.
  const citasSeed = [
    { nombre: 'Karla Torres',    inicioOffsetHoras: 26,  duracionMin: 45, estado: 'agendada' },
    { nombre: 'Valeria Cruz',    inicioOffsetHoras: 50,  duracionMin: 90, estado: 'confirmada' },
    { nombre: 'Fernanda López',  inicioOffsetHoras: -480, duracionMin: 30, estado: 'completada' },
    { nombre: 'Daniela Ramírez', inicioOffsetHoras: -1200, duracionMin: 90, estado: 'completada' },
  ];

  for (const cita of citasSeed) {
    const clienteId = clientesPorNombre[cita.nombre];
    const { data: citaExistente } = await supabase
      .from('citas').select('id').eq('company_id', COMPANY_ID).eq('cliente_id', clienteId).eq('estado', cita.estado).maybeSingle();
    if (citaExistente) continue;

    const inicio = new Date(Date.now() + cita.inicioOffsetHoras * 60 * 60 * 1000);
    const fin = new Date(inicio.getTime() + cita.duracionMin * 60 * 1000);

    await fatal(`creando cita de ${cita.nombre}`, (await supabase
      .from('citas')
      .insert([{ company_id: COMPANY_ID, cliente_id: clienteId, asesor_id: asesoraId, inicio: inicio.toISOString(), fin: fin.toISOString(), estado: cita.estado }])).error);
  }
  console.log('✅ Citas demo listas (1 por confirmar mañana, 1 confirmada, 2 en historial). Sofía Hernández queda sin cita: prospecto nuevo que apenas escribió.');

  console.log('\n🎉 Bella Studio Salón & Spa lista para demo — falta únicamente conectar un número real de WhatsApp Business (Meta) y crear el acceso de la vendedora.');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en seed-demo-bella-studio:', err.message);
  process.exit(1);
});
