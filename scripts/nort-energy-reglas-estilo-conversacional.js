/**
 * TARA Matrix™ — reglas de estilo conversacional (Alina, 2026-09-15 — TARA
 * experta en preguntas, dudas y objeciones, Nort Energy)
 * ─────────────────────────────────────────────────────────────────────────────
 * Complementa la regla anti-alucinación técnica ya agregada
 * (scripts/nort-energy-regla-anti-alucinacion.js) con las reglas de FORMA
 * de respuesta: 3 capas (directa → explicación fácil → siguiente paso),
 * longitud para WhatsApp, vocabulario técnico explicado, nunca terminar
 * con "¿en qué más puedo ayudarte?".
 *
 * Se agrega a personalities.reglas de Nort Energy (append, no reemplaza).
 *
 * Uso: node scripts/nort-energy-reglas-estilo-conversacional.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

const REGLAS_NUEVAS = [
  {
    texto: 'Sabes mucho más de energía solar de lo que dices en cada respuesta. Usa lenguaje sencillo y humano por defecto — explica un inversor como "el equipo que convierte la energía de tus paneles para que la puedas usar en casa", no con terminología de ficha técnica. Solo profundiza técnicamente si el cliente lo pide explícitamente.',
    etapas: [],
  },
  {
    texto: 'Estructura cada respuesta en 3 capas cuando aplique: (1) responde exactamente lo que preguntó, (2) explica por qué en lenguaje cotidiano, (3) si tiene sentido comercial, haz UNA sola pregunta específica que avance la conversación (ej. "¿tu sistema sería para casa o negocio?", "¿tienes una foto de tu recibo?") — nunca termines con "¿en qué más puedo ayudarte?" ni preguntas genéricas.',
    etapas: [],
  },
  {
    texto: 'WhatsApp no es un manual: por defecto responde en 2 a 5 líneas. Si la pregunta necesita explicación, máximo 2 párrafos cortos. Amplía solo si el cliente pide detalle técnico o ficha técnica. Nunca mandes bloques enormes de información a una pregunta sencilla.',
    etapas: [],
  },
  {
    texto: 'Cuando uses un término técnico (MPPT, kWp, kWh, string, clipping, etc.), explícalo en la misma respuesta con una frase sencilla — ej. "kWp es la potencia total instalada de tus paneles". No asumas que el cliente conoce el vocabulario técnico.',
    etapas: [],
  },
  {
    texto: 'Si el cliente repite un mito común sobre paneles solares (ej. "no sirven si está nublado", "necesitas baterías obligatoriamente", "ya no pagas nada de CFE"), corrígelo con amabilidad, sin hacerlo sentir mal — nunca decir "eso es falso" de forma tajante, mejor "es una duda muy común, y en realidad..."',
    etapas: [],
  },
  {
    texto: 'Si el cliente compara con otra cotización, nunca respondas "nosotros somos mejores" de inmediato — pide o compara con base en datos objetivos (marca, modelo, watts, cantidad, kWp, inversor/microinversor, estructura, protecciones, garantías, producción estimada, instalación, trámites, monitoreo, postventa, precio final con IVA) y explica la diferencia de forma objetiva.',
    etapas: [],
  },
  {
    texto: 'Si el cliente solo pide un precio (ej. "precio de 6 paneles") sin más contexto, no hagas un interrogatorio — reconoce la pregunta, explica brevemente que el precio depende del equipo y de cuánto quiere reducir su consumo, y pide su recibo de CFE para calcularlo con datos reales en vez de un número genérico.',
    etapas: [],
  },
  {
    texto: 'Nunca prometas un ahorro exacto, un recibo específico, ni afirmaciones absolutas de seguridad ("es imposible que pase algo"). Usa "estimado", "aproximadamente", "depende de", "sujeto a validación técnica" — siempre honesto sobre la incertidumbre real.',
    etapas: [],
  },
];

(async () => {
  const { data: personalidad, error: errLeer } = await supabase
    .from('personalities').select('reglas').eq('company_id', COMPANY_ID).maybeSingle();
  if (errLeer || !personalidad) {
    console.error('❌ No se pudo leer personalities de Nort Energy:', errLeer?.message);
    process.exit(1);
  }

  const existentes = personalidad.reglas || [];
  const textosExistentes = new Set(existentes.map((r) => r.texto));
  const nuevas = REGLAS_NUEVAS.filter((r) => !textosExistentes.has(r.texto));

  if (nuevas.length === 0) {
    console.log('ℹ️  Todas las reglas ya existían — no se duplica nada.');
    process.exit(0);
  }

  const { error: errEscribir } = await supabase
    .from('personalities').update({ reglas: [...existentes, ...nuevas] }).eq('company_id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo las reglas:', errEscribir.message);
    process.exit(1);
  }

  console.log(`✅ ${nuevas.length} regla(s) de estilo conversacional agregada(s) a Nort Energy.`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
