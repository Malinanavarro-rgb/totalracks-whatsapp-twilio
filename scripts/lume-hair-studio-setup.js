/**
 * TARA Matrix™ — lume-hair-studio-setup (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Personaliza "LUMÉ Hair Studio" (creada vía scripts/crear-empresa.js sobre
 * la plantilla salon_belleza, pensada originalmente para uñas) al giro real:
 * salón de cabello — Alina, 2026-08-11.
 *
 * 1. companies.es_demo = true (aparece en el selector de Demo en Vivo).
 * 2. personalities: TARA como recepcionista premium (tono cálido, breve,
 *    natural — no cuestionario), mensaje de bienvenida y reglas propias.
 * 3. servicios: se borran los 4 de uñas (heredados de la plantilla) y se
 *    insertan los 7 reales del salón, con duración y precio reales. Los
 *    servicios "desde" quedan con ese precio base en `precio` — el matiz de
 *    "sujeto a valoración" vive en el texto libre de la KB (ver abajo), no
 *    en un campo nuevo — el modelo nunca cita un precio fijo que la KB no
 *    respalda.
 * 4. knowledge_base: se reemplaza el contenido de uñas por el de cabello,
 *    con los precios "desde" explícitos en el texto para que TARA nunca los
 *    cite como precio cerrado.
 * 5. El nodo "pedir_servicio" del workflow se actualiza para preguntar por
 *    servicios de cabello, no de uñas.
 * 6. Asesora + horario laboral (lunes a sábado) — sin esto Agenda queda sin
 *    disponibilidad real (mismo patrón que scripts/seed-demo-bella-studio.js).
 *
 * Uso: node scripts/lume-hair-studio-setup.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = 'a0ab9f26-dc75-42fa-9bee-01b987dc6a1b';

const SERVICIOS = [
  { nombre: 'Corte de cabello mujer', duracion_minutos: 60, precio: 450 },
  { nombre: 'Corte + lavado + peinado', duracion_minutos: 90, precio: 650 },
  { nombre: 'Tinte completo', duracion_minutos: 120, precio: 1200 },
  { nombre: 'Balayage', duracion_minutos: 180, precio: 2500 },
  { nombre: 'Retoque de raíz', duracion_minutos: 90, precio: 900 },
  { nombre: 'Tratamiento capilar', duracion_minutos: 60, precio: 700 },
  { nombre: 'Peinado', duracion_minutos: 60, precio: 500 },
];

const KB_SERVICIOS = {
  categoria: 'SERVICIOS',
  contenido: [
    'Corte de cabello mujer: $450, 60 min.',
    'Corte + lavado + peinado: $650, 90 min.',
    'Tinte completo: desde $1,200, 120 min — precio final sujeto a valoración en salón (depende del largo/grosor de cabello y cantidad de producto).',
    'Balayage: desde $2,500, 180 min — precio final sujeto a valoración en salón.',
    'Retoque de raíz: desde $900, 90 min — precio final sujeto a valoración en salón.',
    'Tratamiento capilar: $700, 60 min.',
    'Peinado: desde $500, 60 min — el precio final depende del tipo de peinado (evento, día a día, recogido).',
  ].join('\n'),
};

const KB_SALON = {
  categoria: 'SALÓN',
  contenido: 'LUMÉ Hair Studio — salón de cabello premium en Monterrey, NL. Especialistas en color, balayage y tratamientos capilares.',
};

const PERSONALIDAD = {
  nombre_asistente: 'TARA',
  cargo: 'Recepcionista',
  tono: 'cálido, profesional, breve — estilo premium, nunca suena a bot ni hace preguntas de cuestionario',
  objetivo: 'Agendar citas de servicios de cabello (cortes, color, balayage, tratamientos) para las clientas de LUMÉ Hair Studio, de forma conversacional y natural.',
  mensaje_bienvenida: '¡Hola! 😊 Bienvenida a LUMÉ Hair Studio. Soy TARA, ¿en qué te puedo ayudar?',
  reglas: [
    { texto: 'Nunca mandes un cuestionario completo de golpe — obtén la información de forma conversacional, una pregunta natural a la vez.', etapas: [] },
    { texto: 'Si la clienta menciona un servicio de forma general (ej. "pintarme el cabello"), pregunta amablemente qué opción específica busca (color completo, retoque de raíz, balayage) antes de continuar.', etapas: [] },
    { texto: 'Los precios marcados como "desde" en el catálogo son un punto de partida, nunca el precio final — acláralo si la clienta pregunta el costo de un servicio así marcado.', etapas: [] },
  ],
};

const PREGUNTA_SERVICIO = '¿Qué servicio te gustaría agendar? (corte, corte + peinado, tinte completo, balayage, retoque de raíz, tratamiento capilar, peinado...)';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  // 1. es_demo
  const { error: errDemo } = await supabase.from('companies').update({ es_demo: true }).eq('id', COMPANY_ID);
  await fatal('marcando es_demo', errDemo);
  console.log('✅ companies.es_demo = true');

  // 2. personalidad
  const { data: personalidadActual, error: errLeerPers } = await supabase
    .from('personalities').select('reglas').eq('company_id', COMPANY_ID).single();
  await fatal('leyendo personalities', errLeerPers);

  const { error: errPers } = await supabase.from('personalities').update({
    nombre_asistente: PERSONALIDAD.nombre_asistente,
    cargo: PERSONALIDAD.cargo,
    tono: PERSONALIDAD.tono,
    objetivo: PERSONALIDAD.objetivo,
    mensaje_bienvenida: PERSONALIDAD.mensaje_bienvenida,
    // La regla de desambiguación de catálogo (generada automáticamente al
    // crear la empresa) se conserva — solo se agregan las reglas propias del
    // giro de cabello, sin pisarla.
    reglas: [...(personalidadActual.reglas || []), ...PERSONALIDAD.reglas],
  }).eq('company_id', COMPANY_ID);
  await fatal('actualizando personalities', errPers);
  console.log('✅ personalities actualizada (TARA, recepcionista de cabello)');

  // 3. servicios — fuera los de uñas heredados de la plantilla, dentro los reales
  const { error: errDelServ } = await supabase.from('servicios').delete().eq('company_id', COMPANY_ID);
  await fatal('borrando servicios de uñas heredados', errDelServ);

  const { error: errInsServ } = await supabase.from('servicios').insert(
    SERVICIOS.map(s => ({ company_id: COMPANY_ID, ...s, activo: true }))
  );
  await fatal('insertando servicios de LUMÉ', errInsServ);
  console.log(`✅ servicios: ${SERVICIOS.length} servicios de cabello cargados`);

  // 4. knowledge_base — fuera lo de uñas, dentro lo de cabello
  const { error: errDelKb } = await supabase.from('knowledge_base').delete().eq('company_id', COMPANY_ID);
  await fatal('borrando knowledge_base de uñas heredada', errDelKb);

  const { error: errInsKb } = await supabase.from('knowledge_base').insert([
    { company_id: COMPANY_ID, ...KB_SALON },
    { company_id: COMPANY_ID, ...KB_SERVICIOS },
  ]);
  await fatal('insertando knowledge_base de LUMÉ', errInsKb);
  console.log('✅ knowledge_base reemplazada (salón + servicios de cabello, con precios "desde")');

  // 5. nodo del workflow — pregunta de servicio
  const { data: workflow, error: errWf } = await supabase
    .from('workflows').select('id').eq('company_id', COMPANY_ID).eq('trigger_value', 'interes_compra').maybeSingle();
  await fatal('buscando workflow de agendamiento', errWf);

  if (workflow) {
    const { error: errNodo } = await supabase
      .from('workflow_nodes')
      .update({ pregunta: PREGUNTA_SERVICIO })
      .eq('workflow_id', workflow.id).eq('nombre', 'pedir_servicio');
    await fatal('actualizando pregunta del nodo pedir_servicio', errNodo);
    console.log('✅ nodo pedir_servicio actualizado a servicios de cabello');
  } else {
    console.warn('⚠️  No se encontró el workflow de agendamiento — revisar manualmente.');
  }

  // 6. asesora + horario laboral (lunes a sábado, 10:00-19:00) — sin esto
  //    Agenda no tiene disponibilidad real que ofrecer (mismo patrón que
  //    scripts/seed-demo-bella-studio.js).
  const { data: asesora, error: errAsesora } = await supabase
    .from('asesores')
    .insert([{ company_id: COMPANY_ID, nombre: 'Ana', email: null, activo: true }])
    .select().single();
  await fatal('creando asesora', errAsesora);
  console.log(`✅ asesora creada: ${asesora.nombre} (${asesora.id})`);

  const DIAS_LUN_SAB = [1, 2, 3, 4, 5, 6]; // 1=lunes ... 6=sábado (domingo cerrado)
  const { error: errHorario } = await supabase.from('horarios_laborales').insert(
    DIAS_LUN_SAB.map(dia => ({
      company_id: COMPANY_ID, asesor_id: asesora.id, dia_semana: dia,
      hora_inicio: '10:00', hora_fin: '19:00', zona_horaria: 'America/Monterrey',
    }))
  );
  await fatal('creando horario laboral', errHorario);
  console.log('✅ horario laboral: lunes a sábado, 10:00–19:00 (America/Monterrey)');

  console.log(`\n✅ LUMÉ Hair Studio lista — company_id: ${COMPANY_ID}`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en lume-hair-studio-setup:', err.message);
  process.exit(1);
});
