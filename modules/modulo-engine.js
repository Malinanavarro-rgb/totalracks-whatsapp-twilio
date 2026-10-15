/**
 * TARA Matrix™ — modulo-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 2 — piloto en MODO OBSERVACIÓN (Alina, 2026-10-17,
 * ver TARA_MODULE_ENGINE_FASE2_PROPUESTA_V1.md). Dos piezas:
 *
 *   1. requireModuloActivo() — middleware Express que NUNCA bloquea en esta
 *      fase. Solo registra qué habría pasado (modulo_enforcement_observaciones,
 *      migración 129). El bloqueo efectivo real es una fase posterior, con
 *      su propia autorización explícita — no un flag que se cambia aquí.
 *   2. resolverModulosAutorizadosParaIA() — preparada y probada en esta
 *      fase, pero NO conectada todavía a Orchestrator ni a Modo Operador
 *      (instrucción explícita: no activar restricciones sobre conversaciones
 *      productivas todavía).
 *
 * Regla de fallback, igual en espíritu a roles_permisos: sin fila en
 * modulos_empresa para esa empresa+módulo (empresa con
 * module_engine_configurado_en = NULL, o migrada pero sin opinión sobre
 * ESTE módulo específico) = tratar como permitido, SIEMPRE. Nunca hay
 * bloqueo por ausencia de configuración (instrucción explícita).
 *
 * @module modules/modulo-engine
 */

'use strict';

const { modulosVisibles } = require('./permisos');

/**
 * @returns {Promise<'activo'|'integrado'|'inactivo'|'sin_fila_configurada'>}
 */
async function resolverEstadoModulo(supabase, companyId, moduloCodigo) {
  const { data } = await supabase
    .from('modulos_empresa').select('estado').eq('company_id', companyId).eq('modulo_codigo', moduloCodigo).maybeSingle();
  if (!data) return 'sin_fila_configurada';
  return data.estado;
}

/** 'inactivo' es el ÚNICO estado que bloquearía en una fase de enforcement real — todo lo demás (incluida la ausencia de fila) permite acceso. */
function moduloPermiteAcceso(estado) {
  return estado !== 'inactivo';
}

/** Fire-and-forget, nunca bloquea el request — mismo criterio que modules/audit-logger.js. */
async function registrarObservacion(supabase, { companyId, moduloCodigo, ruta, metodo, rol, estadoEncontrado, hubieraBloqueado }) {
  try {
    await supabase.from('modulo_enforcement_observaciones').insert([{
      company_id: companyId,
      modulo_codigo: moduloCodigo,
      ruta,
      metodo,
      rol: rol || null,
      estado_modulo_encontrado: estadoEncontrado,
      hubiera_bloqueado: hubieraBloqueado,
    }]);
  } catch (e) {
    console.error('modulo-engine: error registrando observación (nunca bloquea el request):', e.message);
  }
}

/**
 * Middleware Express — MODO OBSERVACIÓN EXCLUSIVAMENTE. Siempre llama
 * next() — nunca responde 403, sin importar el estado encontrado. Registra
 * en modulo_enforcement_observaciones qué habría ocurrido si el bloqueo
 * estuviera activo, para poder presentar resultados reales antes de pedir
 * autorización para el bloqueo efectivo.
 */
function requireModuloActivo(moduloCodigo) {
  return async function (req, res, next) {
    try {
      const estado = await resolverEstadoModulo(req.supabase, req.usuario.company_id, moduloCodigo);
      const hubieraBloqueado = !moduloPermiteAcceso(estado);
      await registrarObservacion(req.supabase, {
        companyId: req.usuario.company_id,
        moduloCodigo,
        ruta: req.originalUrl,
        metodo: req.method,
        rol: req.usuario.rol,
        estadoEncontrado: estado,
        hubieraBloqueado,
      });
    } catch (e) {
      console.error('requireModuloActivo (modo observación): error, nunca bloquea:', e.message);
    }
    next();
  };
}

/**
 * Preparada y probada en esta fase — NO conectada todavía a Orchestrator ni
 * a Modo Operador (eso requiere autorización separada, es la siguiente
 * fase real). Cruza qué módulos puede VER el rol (modulosVisibles, ya
 * existente, sin cambios) con qué módulos NO están marcados 'inactivo' —
 * un módulo sin fila configurada nunca se excluye aquí.
 *
 * @returns {Promise<string[]>} códigos de módulo que la IA podría ofrecer/ejecutar
 */
async function resolverModulosAutorizadosParaIA(supabase, { companyId, rol }) {
  const [{ data: filasModulos }, visibles] = await Promise.all([
    supabase.from('modulos_empresa').select('modulo_codigo, estado').eq('company_id', companyId),
    modulosVisibles(supabase, { companyId, rol }),
  ]);

  const inactivos = new Set((filasModulos || []).filter((f) => f.estado === 'inactivo').map((f) => f.modulo_codigo));
  return visibles.filter((modulo) => !inactivos.has(modulo));
}

module.exports = {
  resolverEstadoModulo, moduloPermiteAcceso, registrarObservacion,
  requireModuloActivo, resolverModulosAutorizadosParaIA,
};
