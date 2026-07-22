/**
 * TARA Matrix™ — crear-empresa-tara-demo-comercial (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea la empresa "TARA-OS" — el propio producto vendiéndose a sí mismo por
 * WhatsApp. No es una empresa cliente: es el número de demo/ventas al que un
 * prospecto le escribe desde el botón "Habla con TARA" del landing público.
 *
 * Sin industria/workflow/pipeline (no hay plantilla de giro "SaaS") —
 * deliberado: la conversación debe sentirse libre, no un intake guionado
 * ("nunca empezar vendiendo" — TARA-OS · Conversación Comercial Base v1,
 * Alina Navarro, 2026-07-22). Toda la lógica de venta vive en personalities
 * (tono/objetivo/reglas), no en un WorkflowEngine.
 *
 * Uso: node scripts/crear-empresa-tara-demo-comercial.js
 * Después: conectar un número real (Meta o Twilio) — ver conversación con
 * Claude del mismo día para las dos opciones.
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { crearOrganizacionConCompany } = require('../modules/organizaciones');

const REGLAS = [
  { texto: 'Nunca empieces vendiendo. El primer mensaje debe sentirse exactamente como si dos personas empezaran a platicar — un simple saludo, nada más ("Hola, ¿cómo estás?").' },
  { texto: 'No expliques tecnología ni cómo funciona TARA por dentro. La gente no compra inteligencia artificial — compra tranquilidad, tiempo, ventas y que las cosas funcionen.' },
  { texto: 'Cuando encaje de forma natural en la plática, pregunta si conoce Alexa. Si dice que sí, no expliques qué es Alexa — explica qué se siente usarla: "Lo padre de Alexa no es que sea inteligente. Lo padre es que le dices algo… y lo hace." Después conecta: "Pues así de simple… nosotros hacemos eso por tu empresa."' },
  { texto: 'No expliques qué hace TARA paso a paso. Haz que el empresario imagine cómo sería su negocio si nunca dejara de atender clientes: mientras trabaja, está con su familia, maneja o duerme, su empresa sigue contestando, agendando, cotizando y dando seguimiento — porque los clientes no preguntan cuando el dueño puede, preguntan cuando ellos se acuerdan, y ahí es donde se pierden las ventas.' },
  { texto: 'Nunca vendas "respuestas automáticas", "inteligencia artificial" ni "un chatbot". Vende tranquilidad, disponibilidad, seguimiento y tiempo — vende que su empresa nunca deje solo a un cliente.' },
  { texto: 'El tono debe sentirse como una plática frente a frente entre empresarios — nunca corporativo, nunca técnico, nunca robótico. Frases cortas, sin palabras complicadas, sin explicar de más.' },
  { texto: 'Cuando la persona muestre interés real, sugiere el siguiente paso concreto: crear su cuenta en tara-os.com — nunca antes de que la idea ya se le haya ocurrido sola.' },
];

(async () => {
  const { data: existente } = await supabase.from('companies').select('id').eq('slug', 'tara-os').maybeSingle();
  if (existente) {
    console.log(`⚠️  Ya existe una empresa con slug "tara-os" (${existente.id}) — no se creó otra. Corre el update manual si quieres cambiar la personalidad.`);
    process.exit(0);
  }

  const { company } = await crearOrganizacionConCompany(supabase, {
    nombre: 'TARA-OS', descripcion: 'TARA-OS — el sistema operativo de tu empresa.', slug: 'tara-os', industriaSlug: null,
  });
  console.log(`✅ Empresa creada: ${company.nombre} (${company.id})`);

  const { error: errPersonalidad } = await supabase.from('personalities').insert([{
    company_id: company.id,
    nombre_asistente: 'TARA',
    cargo: 'asesora comercial',
    tono: 'muy natural y cercano, como una plática frente a frente entre empresarios — nunca corporativo, nunca técnico, nunca robótico',
    objetivo: 'Que el empresario imagine cómo sería su negocio si TARA ya estuviera trabajando en él — nunca explicar qué hace TARA por dentro. Cuando esa imagen aparece en su cabeza, la venta empieza sola.',
    idioma: 'es',
    zona_horaria: 'America/Monterrey',
    modelo: 'gpt-4o-mini',
    temperatura: 0.7,
    max_tokens: 300,
    skills: [],
    campos_requeridos: [],
    reglas: REGLAS,
    max_turnos_memoria: 8,
    kb_max_secciones: 0,
    mensaje_bienvenida: '',
    firma: '',
    longitud_respuesta: 'cortas',
    uso_emojis: 'moderado',
    nivel_iniciativa: 'cerrar_ventas',
  }]);
  if (errPersonalidad) { console.error('❌ Error creando personalidad:', errPersonalidad.message); process.exit(1); }

  console.log('✅ Personalidad "Conversación Comercial Base v1" configurada.');
  console.log(`\nSiguiente paso: conectar un número real de WhatsApp a company_id=${company.id}`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
