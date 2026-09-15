/**
 * TARA Matrix™ — regla anti-alucinación técnica (Alina, 2026-09-15 — TARA
 * especialista solar, Nort Energy)
 * ─────────────────────────────────────────────────────────────────────────────
 * Jerarquía de conocimiento (sección 10 de la Ficha Maestra de Proveedor):
 * ficha oficial del modelo → catálogo SOLES vigente → base interna de Nort
 * Energy → conocimiento fotovoltaico general. Nunca usar conocimiento
 * general para inventar una característica específica de un modelo.
 *
 * Se agrega a personalities.reglas de Nort Energy (append, no reemplaza las
 * reglas existentes) — exclusivo de esa empresa, mismo patrón ya usado para
 * las otras reglas de Nort Energy.
 *
 * Uso: node scripts/nort-energy-regla-anti-alucinacion.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

const REGLA_ANTI_ALUCINACION = {
  texto: 'Cuando hables de las especificaciones técnicas de un modelo específico (potencia, voltaje, corriente, compatibilidad, garantía, etc.), usa ÚNICAMENTE lo que aparezca en el bloque "CATÁLOGO TÉCNICO REAL" de este turno, si existe. Si un producto ahí dice "FICHA TÉCNICA PENDIENTE DE CONFIRMAR", nunca completes los datos que faltan con conocimiento general — di que vas a confirmarlo con el proveedor. Si no hay ningún bloque de catálogo técnico para lo que el cliente pregunta, responde con conocimiento general fotovoltaico (explicado de forma clara, sin tecnicismos innecesarios) pero deja claro que es información general, no la ficha de un modelo específico — nunca inventes Voc, Vmp, Isc, rango MPPT ni ninguna especificación eléctrica de un modelo que no esté confirmada. Es mejor decir "necesito confirmar ese dato" que inventarlo.',
  etapas: [],
};

(async () => {
  const { data: personalidad, error: errLeer } = await supabase
    .from('personalities').select('reglas').eq('company_id', COMPANY_ID).maybeSingle();
  if (errLeer || !personalidad) {
    console.error('❌ No se pudo leer personalities de Nort Energy:', errLeer?.message);
    process.exit(1);
  }

  const yaExiste = (personalidad.reglas || []).some((r) => r.texto === REGLA_ANTI_ALUCINACION.texto);
  if (yaExiste) {
    console.log('ℹ️  La regla anti-alucinación ya existía — no se duplica.');
    process.exit(0);
  }

  const nuevasReglas = [...(personalidad.reglas || []), REGLA_ANTI_ALUCINACION];
  const { error: errEscribir } = await supabase
    .from('personalities').update({ reglas: nuevasReglas }).eq('company_id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo la regla:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Regla anti-alucinación técnica agregada a Nort Energy.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
