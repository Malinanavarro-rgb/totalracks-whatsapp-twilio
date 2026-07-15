/**
 * TARA Matrix™ — agenda-config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1). La configuración de industria vive
 * como datos en la tabla `agenda_config` (1 fila por empresa), no como
 * código nuevo por rubro — mismo espíritu que `plantillas_industria` para
 * onboarding. Este módulo valida el shape a mano (sin librería de schema:
 * el proyecto no tiene ninguna dependencia de validación hoy y el shape es
 * simple y conocido — si crece mucho, una librería real es el siguiente
 * paso, no este).
 *
 * `obtenerAgendaConfig()` devuelve `null` cuando la empresa no tiene fila —
 * eso es intencional: es la señal que usa el frontend para decidir si
 * muestra la Agenda clásica o la experiencia universal (Agenda.jsx).
 *
 * @module modules/agenda-config
 */

'use strict';

const REGLAS_VALIDAS = [
  'retraso', 'saturacion', 'tiempo_muerto', 'riesgo_tarde', 'hueco_insertable', 'no_show_candidato',
];

const DEFAULT_AGENDA_CONFIG = {
  terminologia: {
    recurso:  { singular: 'Recurso',  plural: 'Recursos' },
    bloque:   { singular: 'Reserva',  plural: 'Reservas' },
    contacto: { singular: 'Cliente',  plural: 'Clientes' },
  },
  umbrales: {
    citas_seguidas_saturacion:   4,
    minutos_tiempo_muerto:       90,
    margen_retraso_minutos:      5,
    minutos_riesgo_anticipacion: 30,
    hueco_insertable_min:        30,
    hueco_insertable_max:        60,
    no_show_minutos:             15,
  },
  reglas_prioritarias: [...REGLAS_VALIDAS],
};

/**
 * Valida el shape de un agenda_config. Lanza Error con mensaje legible en
 * el primer problema encontrado — no acumula una lista de errores (no hace
 * falta para un shape de este tamaño).
 */
function validarAgendaConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('agenda_config inválido: se esperaba un objeto');

  for (const clave of ['recurso', 'bloque', 'contacto']) {
    const termino = config.terminologia?.[clave];
    if (!termino || typeof termino.singular !== 'string' || typeof termino.plural !== 'string') {
      throw new Error(`agenda_config inválido: terminologia.${clave} debe tener singular/plural de texto`);
    }
  }

  const umbrales = config.umbrales;
  if (!umbrales || typeof umbrales !== 'object') throw new Error('agenda_config inválido: falta umbrales');
  for (const clave of Object.keys(DEFAULT_AGENDA_CONFIG.umbrales)) {
    const valor = umbrales[clave];
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      throw new Error(`agenda_config inválido: umbrales.${clave} debe ser un número positivo`);
    }
  }

  if (!Array.isArray(config.reglas_prioritarias) || config.reglas_prioritarias.length === 0) {
    throw new Error('agenda_config inválido: reglas_prioritarias debe ser un arreglo no vacío');
  }
  for (const regla of config.reglas_prioritarias) {
    if (!REGLAS_VALIDAS.includes(regla)) {
      throw new Error(`agenda_config inválido: regla desconocida "${regla}"`);
    }
  }

  return true;
}

/**
 * @returns {Promise<Object|null>} la fila real, o null si la empresa no
 *   tiene agenda_config todavía (señal de "usa la Agenda clásica").
 */
async function obtenerAgendaConfig(supabase, company_id) {
  const { data, error } = await supabase
    .from('agenda_config')
    .select('company_id, schema_version, config, updated_at')
    .eq('company_id', company_id)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function actualizarAgendaConfig(supabase, company_id, config) {
  validarAgendaConfig(config);

  const { data, error } = await supabase
    .from('agenda_config')
    .upsert({ company_id, config, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
    .select('company_id, schema_version, config, updated_at')
    .single();

  if (error) throw new Error(`agenda-config.actualizarAgendaConfig: ${error.message}`);
  return data;
}

module.exports = {
  REGLAS_VALIDAS,
  DEFAULT_AGENDA_CONFIG,
  validarAgendaConfig,
  obtenerAgendaConfig,
  actualizarAgendaConfig,
};
