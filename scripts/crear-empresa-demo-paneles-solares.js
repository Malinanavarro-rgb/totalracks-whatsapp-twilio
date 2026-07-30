/**
 * TARA Matrix™ — crear-empresa-demo-paneles-solares (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea "Empresa Demo Paneles Solares", la empresa de ejemplo de paneles solares para usar
 * en demostraciones de venta de TARA-OS (Alina, 2026-07-29: "podemos poner
 * como ejemplo a tara para que haga las conversaciones... para una empresa
 * de paneles"). Usa el mecanismo real del Motor Universal — la plantilla
 * plantillas_industria.paneles_solares (migración 082) — no un script con
 * personalidad improvisada: así queda reusable también para cualquier
 * cliente real de paneles solares que se registre después, igual que
 * scripts/crear-empresa.js + scripts/seed-demo-bella-studio.js combinados
 * en un solo script (esta empresa nace ya lista para demo, sin un segundo
 * paso manual).
 *
 * La descripción del negocio está redactada para que detectarIndustria()
 * (modules/plantillas-industria.js) coincida con paneles_solares y con
 * ninguna otra plantilla — confirmado por sus palabras_clave únicas
 * (panel solar, energía solar, fotovoltaico, cfe...).
 *
 * Uso: node scripts/crear-empresa-demo-paneles-solares.js
 * Después: conectar un número real de WhatsApp (Meta o Twilio) para demos en vivo.
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { crearEmpresaConIndustria } = require('../modules/plantillas-industria');

const NOMBRE = 'Empresa Demo Paneles Solares';
const SLUG = 'vive-solar-mty';
const DESCRIPCION = 'Instalación y venta de paneles solares residenciales y comerciales. Energía solar fotovoltaica con financiamiento a meses, ahorro real en tu recibo de CFE. Monterrey, NL.';
const TECNICO_NOMBRE = 'Ricardo';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  // 1. Empresa + plantilla paneles_solares (personalidad, KB, servicios, pipeline, workflow) ---
  const { data: existente } = await supabase.from('companies').select('id').eq('slug', SLUG).maybeSingle();
  let companyId;

  if (existente) {
    companyId = existente.id;
    console.log(`⚠️  Ya existe una empresa con slug "${SLUG}" (${companyId}) — se reusa para completar el seed de demo.`);
  } else {
    const { company, industriaDetectada, huboCoincidencia } = await crearEmpresaConIndustria(supabase, {
      nombre: NOMBRE, descripcionNegocio: DESCRIPCION, slug: SLUG,
    });
    companyId = company.id;
    console.log(`✅ Empresa creada: ${company.nombre} (${companyId})`);

    if (!huboCoincidencia || industriaDetectada !== 'Paneles Solares') {
      console.error(`❌ TARA no detectó la plantilla "paneles_solares" (detectó: ${industriaDetectada || 'ninguna'}). Revisa palabras_clave en migrations/082_plantilla_paneles_solares.sql antes de continuar.`);
      process.exit(1);
    }
    console.log('✅ Plantilla "Paneles Solares" aplicada: personalidad, base de conocimiento, servicios, pipeline y workflow listos.');
  }

  // 2. Técnico/asesor + horario laboral (requiere_agenda=true — sin esto, Agenda queda rota) ---
  const { data: tecnicoExistente } = await supabase
    .from('asesores').select('id').eq('company_id', companyId).eq('nombre', TECNICO_NOMBRE).maybeSingle();

  let tecnicoId = tecnicoExistente?.id;
  if (!tecnicoId) {
    const { data: tecnico, error: errTecnico } = await supabase
      .from('asesores').insert([{ company_id: companyId, nombre: TECNICO_NOMBRE, activo: true }]).select().single();
    await fatal('creando técnico', errTecnico);
    tecnicoId = tecnico.id;
  }
  console.log(`✅ Técnico "${TECNICO_NOMBRE}" listo (${tecnicoId}).`);

  const { data: horariosExistentes } = await supabase
    .from('horarios_laborales').select('dia_semana').eq('company_id', companyId).is('asesor_id', null);
  const diasYaConfigurados = new Set((horariosExistentes || []).map(h => h.dia_semana));
  const diasFaltantes = [1, 2, 3, 4, 5, 6].filter(d => !diasYaConfigurados.has(d));
  if (diasFaltantes.length) {
    await fatal('creando horarios laborales', (await supabase
      .from('horarios_laborales')
      .insert(diasFaltantes.map(dia => ({
        company_id: companyId, asesor_id: null, dia_semana: dia,
        hora_inicio: '08:00', hora_fin: '18:00', zona_horaria: 'America/Monterrey',
      })))).error);
  }
  console.log('✅ Horario laboral lunes a sábado 08:00–18:00 (domingo cerrado).');

  // 3. Clientes demo — uno por cada etapa del pipeline, para que el panel se vea real ---
  const clientesSeed = [
    { nombre: 'Jorge Villarreal',  telefono: '+5218112346101', ciudad: 'San Pedro Garza García', score_interes: 30 },
    { nombre: 'Marisol Cantú',     telefono: '+5218112346102', ciudad: 'Monterrey',               score_interes: 50 },
    { nombre: 'Refaccionaria Cantú', telefono: '+5218112346103', ciudad: 'Guadalupe',              score_interes: 65 },
    { nombre: 'Adriana Longoria',  telefono: '+5218112346104', ciudad: 'San Nicolás',              score_interes: 80 },
    { nombre: 'Hotel Rincón Azul', telefono: '+5218112346105', ciudad: 'Santa Catarina',           score_interes: 90 },
    { nombre: 'Eduardo Salinas',   telefono: '+5218112346106', ciudad: 'Apodaca',                  score_interes: 20 },
  ];

  const clientesPorNombre = {};
  for (const c of clientesSeed) {
    const { data: existenteCliente } = await supabase
      .from('clientes').select('id').eq('company_id', companyId).eq('telefono', c.telefono).maybeSingle();
    if (existenteCliente) { clientesPorNombre[c.nombre] = existenteCliente.id; continue; }

    const { data: nuevo, error: errCliente } = await supabase
      .from('clientes')
      .insert([{ company_id: companyId, nombre: c.nombre, telefono: c.telefono, ciudad: c.ciudad, fuente: 'WhatsApp', score_interes: c.score_interes }])
      .select().single();
    await fatal(`creando cliente ${c.nombre}`, errCliente);
    clientesPorNombre[c.nombre] = nuevo.id;
  }
  console.log('✅ 6 clientes demo listos.');

  // 4. Oportunidades demo — una por etapa del pipeline (Nuevo → Perdido) ---
  const oportunidadesSeed = [
    { nombre: 'Jorge Villarreal',    estado: 'Nuevo',              descripcion: 'Casa de 2 pisos, quiere reducir su recibo de CFE.', presupuesto_estimado: 95000,  presupuesto_confirmado: null,   probabilidad: 20, hace_dias: 1 },
    { nombre: 'Marisol Cantú',       estado: 'Calificado',          descripcion: 'Consumo de $2,400 bimestrales, casa en San Jerónimo.', presupuesto_estimado: 110000, presupuesto_confirmado: null,   probabilidad: 35, hace_dias: 2 },
    { nombre: 'Refaccionaria Cantú', estado: 'Visita agendada',     descripcion: 'Negocio con techo amplio, consumo comercial alto.', presupuesto_estimado: 180000, presupuesto_confirmado: null,   probabilidad: 55, hace_dias: 3 },
    { nombre: 'Adriana Longoria',    estado: 'Cotización enviada',  descripcion: 'Visita técnica realizada — cotización de sistema de 8kW enviada.', presupuesto_estimado: 165000, presupuesto_confirmado: null, probabilidad: 70, hace_dias: 4 },
    { nombre: 'Hotel Rincón Azul',   estado: 'Cerrado',             descripcion: 'Sistema comercial de 25kW instalado.', presupuesto_estimado: 520000, presupuesto_confirmado: 495000, probabilidad: 99, hace_dias: 20 },
    { nombre: 'Eduardo Salinas',     estado: 'Perdido',             descripcion: 'Decidió esperar al próximo año por presupuesto.', presupuesto_estimado: 88000,  presupuesto_confirmado: null,   probabilidad: 0,  hace_dias: 15 },
  ];

  for (const op of oportunidadesSeed) {
    const clienteId = clientesPorNombre[op.nombre];
    const { data: existenteOp } = await supabase
      .from('oportunidades').select('id').eq('company_id', companyId).eq('cliente_id', clienteId).eq('estado', op.estado).maybeSingle();
    if (existenteOp) continue;

    const updatedAt = new Date(Date.now() - op.hace_dias * 24 * 60 * 60 * 1000);
    await fatal(`creando oportunidad de ${op.nombre}`, (await supabase
      .from('oportunidades')
      .insert([{
        company_id: companyId, cliente_id: clienteId, estado: op.estado, descripcion: op.descripcion,
        presupuesto_estimado: op.presupuesto_estimado, presupuesto_confirmado: op.presupuesto_confirmado,
        probabilidad: op.probabilidad, updated_at: updatedAt.toISOString(),
      }])).error);
  }
  console.log('✅ 6 oportunidades demo listas (una por etapa del pipeline, incluida una venta cerrada de $495,000).');

  // 5. Citas demo — la visita técnica de Refaccionaria Cantú (agenda real) ---
  const citaClienteId = clientesPorNombre['Refaccionaria Cantú'];
  const { data: citaExistente } = await supabase
    .from('citas').select('id').eq('company_id', companyId).eq('cliente_id', citaClienteId).eq('estado', 'agendada').maybeSingle();

  if (!citaExistente) {
    const inicio = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const fin = new Date(inicio.getTime() + 90 * 60 * 1000);
    await fatal('creando cita de visita técnica', (await supabase
      .from('citas')
      .insert([{ company_id: companyId, cliente_id: citaClienteId, asesor_id: tecnicoId, inicio: inicio.toISOString(), fin: fin.toISOString(), estado: 'agendada' }])).error);
  }
  console.log('✅ Visita técnica de Refaccionaria Cantú agendada (mañana) — aparece en Agenda y en "Confirmaciones pendientes".');

  console.log(`\n🎉 ${NOMBRE} lista para demo (company_id=${companyId}) — falta únicamente conectar un número real de WhatsApp para probar la conversación en vivo con un prospecto.`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en crear-empresa-demo-paneles-solares:', err.message);
  process.exit(1);
});
