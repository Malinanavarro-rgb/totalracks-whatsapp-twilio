/**
 * TARA Matrix™ — AuditLogger
 * ─────────────────────────────────────────────────────────────────────────────
 * Registro completo de eventos, decisiones y llamadas al AI Engine.
 *
 * Principios de diseño:
 *   1. Fire-and-forget: log() retorna inmediatamente, nunca bloquea el flujo
 *   2. Silencio seguro: si Supabase falla, TARA sigue respondiendo
 *   3. Trazabilidad: cada entrada tiene company_id, canal e identificador
 *   4. flush(): permite esperar writes pendientes en shutdown graceful
 *
 * El Orchestrator (M7) es quien lo instancia y pasa el ConversationContext
 * (que contiene company_id, canal, identificador_cliente) a cada helper.
 *
 * Tabla Supabase requerida: decision_logs
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE TABLE decision_logs (
 *   id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   company_id    uuid NOT NULL,
 *   created_at    timestamptz DEFAULT now(),
 *   tipo          text NOT NULL,
 *   canal         text,
 *   identificador text,
 *   payload       jsonb NOT NULL DEFAULT '{}',
 *   latencia_ms   integer,
 *   costo_usd     numeric(10,6),
 *   tokens_total  integer,
 *   error         text,
 *   session_id    uuid
 * );
 * CREATE INDEX ON decision_logs (company_id, created_at DESC);
 * CREATE INDEX ON decision_logs (company_id, tipo);
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tipos de evento:
 *   'ai_call'       — llamada al AI Engine (tokens, costo, latencia, confianza)
 *   'decision'      — decisión tomada por el Decision Engine (determinístico)
 *   'accion'        — acción propuesta o ejecutada por el Action Runner
 *   'channel_event' — evento del canal (mensaje recibido, enviado, error)
 *   'workflow'      — cambio de estado en el Workflow Engine
 *   'error'         — error capturado en cualquier módulo
 *
 * @module modules/audit-logger
 */

'use strict';

// Tipos válidos de evento — extensibles en versiones futuras
const TIPOS_VALIDOS = new Set([
  'ai_call',
  'decision',
  'accion',
  'channel_event',
  'workflow',
  'error',
]);

class AuditLogger {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
   */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new Error('AuditLogger requiere un cliente de Supabase');
    }
    this._db      = supabaseClient;
    this._pending = new Set();     // promesas en vuelo
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MÉTODO NÚCLEO — fire-and-forget
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra un evento. Retorna inmediatamente — nunca bloquea.
   *
   * @param {Object}      entry
   * @param {string}      entry.company_id
   * @param {string}      entry.tipo           - Ver TIPOS_VALIDOS
   * @param {string}      [entry.canal]
   * @param {string}      [entry.identificador]
   * @param {Object}      [entry.payload]
   * @param {number}      [entry.latencia_ms]
   * @param {number}      [entry.costo_usd]
   * @param {number}      [entry.tokens_total]
   * @param {string}      [entry.error]
   * @param {string}      [entry.session_id]
   * @returns {void}
   */
  log(entry) {
    // Validación síncrona — errores obvios se reportan de inmediato
    if (!entry?.company_id) {
      console.error('❌ AuditLogger: company_id requerido — entrada descartada');
      return;
    }
    if (!entry?.tipo) {
      console.error('❌ AuditLogger: tipo requerido — entrada descartada');
      return;
    }

    const registro = this._normalizar(entry);

    const promise = this._escribir(registro)
      .catch(err => {
        // Fallo silencioso — TARA nunca se detiene por el logger
        console.error(`❌ AuditLogger [${entry.tipo}]: ${err.message}`);
      })
      .finally(() => {
        this._pending.delete(promise);
      });

    this._pending.add(promise);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS SEMÁNTICOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra una llamada al AI Engine con sus métricas.
   *
   * @param {Object} ctx       - ConversationContext del ContextBuilder
   * @param {Object} aiInput   - AIInput enviado al AI Engine
   * @param {Object} aiOutput  - AIOutput recibido del AI Engine
   * @param {Object} [opts]
   * @param {number} [opts.costo_usd]
   * @param {string} [opts.session_id]
   */
  logAICall(ctx, aiInput, aiOutput, opts = {}) {
    this.log({
      company_id:    ctx.company_id,
      tipo:          'ai_call',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        modelo:              aiOutput.modelo_utilizado,
        proveedor:           aiOutput.proveedor_utilizado,
        confianza:           aiOutput.confianza,
        intenciones:         aiOutput.intenciones,
        sentimiento:         aiOutput.sentimiento,
        categoria_principal: aiOutput.categoria_principal,
        etapa_sugerida:      aiOutput.etapa_sugerida,
        acciones_count:      (aiOutput.acciones_propuestas || []).length,
        etapa_cliente:       ctx.cliente?.etapa_actual || null,
        campos_faltantes:    ctx.cliente?.campos_faltantes || [],
      },
      latencia_ms:  aiOutput.latencia_ms,
      costo_usd:    opts.costo_usd ?? null,
      tokens_total: (aiOutput.tokens_entrada || 0) + (aiOutput.tokens_salida || 0),
    });
  }

  /**
   * Registra una decisión tomada por el Decision Engine (determinístico).
   *
   * @param {Object} ctx
   * @param {string} modulo    - Módulo que tomó la decisión
   * @param {string} decision  - Qué se decidió
   * @param {string} razon     - Por qué se tomó esa decisión
   * @param {Object} [opts]
   */
  logDecision(ctx, modulo, decision, razon, opts = {}) {
    this.log({
      company_id:    ctx.company_id,
      tipo:          'decision',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        modulo,
        decision,
        razon,
        etapa_cliente:   ctx.cliente?.etapa_actual || null,
        workflow_actual: ctx.conversacion?.workflow_actual || null,
      },
    });
  }

  /**
   * Registra una acción propuesta o ejecutada por el Action Runner.
   *
   * @param {Object}  ctx
   * @param {string}  tipo        - Tipo de acción ('crear_oportunidad', etc.)
   * @param {Object}  parametros  - Parámetros de la acción
   * @param {Object}  resultado   - Resultado de la ejecución
   * @param {Object}  [opts]
   */
  logAccion(ctx, tipo, parametros, resultado, opts = {}) {
    const exito = resultado?.exito !== false && !resultado?.error;
    this.log({
      company_id:    ctx.company_id,
      tipo:          'accion',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        tipo_accion:  tipo,
        parametros:   parametros || {},
        exito,
        resultado_id: resultado?.id || null,
        detalle:      resultado?.mensaje || null,
      },
      error: exito ? null : (resultado?.error || 'Acción fallida'),
      latencia_ms: opts.latencia_ms || null,
    });
  }

  /**
   * Registra un evento del canal (mensaje recibido, enviado, error de envío).
   *
   * @param {Object} ctx
   * @param {string} tipo   - 'mensaje_recibido' | 'mensaje_enviado' | 'error_canal'
   * @param {Object} [datos]
   * @param {Object} [opts]
   */
  logChannelEvent(ctx, tipo, datos = {}, opts = {}) {
    this.log({
      company_id:    ctx.company_id,
      tipo:          'channel_event',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        subtipo:      tipo,
        preview:      datos.preview || null,
        mensaje_sid:  datos.mensaje_sid || null,
        num_media:    datos.num_media || null,
        latencia_ms:  datos.latencia_ms || null,
      },
      error: datos.error || null,
    });
  }

  /**
   * Registra un error capturado en cualquier módulo.
   *
   * @param {Object} ctx
   * @param {string} modulo  - Módulo donde ocurrió el error
   * @param {Error}  error
   * @param {Object} [opts]
   */
  logError(ctx, modulo, error, opts = {}) {
    this.log({
      company_id:    ctx.company_id,
      tipo:          'error',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        modulo,
        tipo_error:  error?.name  || 'Error',
        mensaje:     error?.message || String(error),
        stack:       error?.stack?.split('\n').slice(0, 5).join('\n') || null,
      },
      error: error?.message || String(error),
    });
  }

  /**
   * Registra un cambio de estado en el Workflow Engine.
   *
   * @param {Object} ctx
   * @param {string} evento  - 'inicio' | 'paso_completado' | 'fin' | 'timeout' | 'error'
   * @param {Object} [datos]
   * @param {Object} [opts]
   */
  logWorkflow(ctx, evento, datos = {}, opts = {}) {
    this.log({
      company_id:    ctx.company_id,
      tipo:          'workflow',
      canal:         ctx.canal,
      identificador: ctx.cliente?.identificador || null,
      session_id:    opts.session_id || null,
      payload: {
        evento,
        workflow:    ctx.conversacion?.workflow_actual    || datos.workflow    || null,
        paso_actual: ctx.conversacion?.workflow_paso_actual || datos.paso_actual || null,
        paso_siguiente: datos.paso_siguiente || null,
        etapa_cliente:  ctx.cliente?.etapa_actual || null,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Espera a que todos los writes pendientes terminen.
   * Usar en shutdown graceful del servidor.
   * @returns {Promise<void>}
   */
  async flush() {
    await Promise.allSettled([...this._pending]);
  }

  /**
   * Número de writes pendientes en vuelo.
   * @returns {number}
   */
  getBufferSize() {
    return this._pending.size;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVADOS
  // ═══════════════════════════════════════════════════════════════════════════

  _normalizar(entry) {
    return {
      company_id:    entry.company_id,
      tipo:          entry.tipo,
      canal:         entry.canal         ?? null,
      identificador: entry.identificador ?? null,
      payload:       entry.payload        ?? {},
      latencia_ms:   entry.latencia_ms   != null ? Math.round(entry.latencia_ms)  : null,
      costo_usd:     entry.costo_usd     != null ? Number(entry.costo_usd.toFixed(6)) : null,
      tokens_total:  entry.tokens_total  != null ? Math.round(entry.tokens_total) : null,
      error:         entry.error         ?? null,
      session_id:    entry.session_id    ?? null,
    };
  }

  async _escribir(registro) {
    const { error } = await this._db
      .from('decision_logs')
      .insert([registro]);

    if (error) {
      throw new Error(`Supabase insert falló: ${error.message}`);
    }
  }
}

module.exports = { AuditLogger, TIPOS_VALIDOS };
