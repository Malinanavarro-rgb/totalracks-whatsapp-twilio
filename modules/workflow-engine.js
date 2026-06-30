/**
 * TARA Matrix™ — WorkflowEngine (M5)
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de flujos conversacionales estructurados.
 *
 * Responsabilidades:
 *   - Detectar si una intención activa un workflow (evaluar)
 *   - Gestionar el estado de sesión activa por cliente+empresa (workflow_sessions)
 *   - Avanzar nodo a nodo capturando campos (avanzar)
 *   - Abandonar flujos cuando el cliente lo solicita (abandonar)
 *
 * El WorkflowEngine nunca genera texto de respuesta.
 * Le dice al Orchestrator QUÉ preguntar — el Orchestrator decide CÓMO.
 *
 * modo_respuesta por nodo:
 *   'prepend_ai'  → Orchestrator combina: transición AI (2 frases) + pregunta del nodo
 *   'replace_ai'  → Orchestrator usa solo la pregunta del nodo
 *   'silent'      → Sin respuesta visible (reservado FASE 4B+)
 *
 * @module modules/workflow-engine
 */

'use strict';

class WorkflowEngine {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this._db = supabase;
  }

  // ── API pública ─────────────────────────────────────────────────────────────

  /**
   * Busca el workflow de mayor prioridad que coincida con alguna intención.
   * Retorna el workflow o null si ninguno hace match.
   *
   * @param {string}   company_id
   * @param {string[]} intenciones  — catálogo controlado de FASE 4A
   * @returns {Promise<Object|null>}
   */
  async evaluar(company_id, intenciones) {
    if (!company_id || !Array.isArray(intenciones) || intenciones.length === 0) {
      return null;
    }

    const { data, error } = await this._db
      .from('workflows')
      .select('*')
      .eq('company_id', company_id)
      .eq('activo', true)
      .eq('trigger', 'intent')
      .in('trigger_value', intenciones)
      .order('prioridad', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('⚠️  WorkflowEngine.evaluar error:', error.message);
      return null;
    }

    return data || null;
  }

  /**
   * Retorna la sesión activa de un cliente para esta empresa, o null.
   *
   * @param {string} company_id
   * @param {number} cliente_id   — bigint en DB
   * @returns {Promise<Object|null>}
   */
  async obtenerSesionActiva(company_id, cliente_id) {
    if (!company_id || !cliente_id) return null;

    const { data, error } = await this._db
      .from('workflow_sessions')
      .select('*')
      .eq('company_id', company_id)
      .eq('cliente_id', cliente_id)
      .eq('status', 'activo')
      .maybeSingle();

    if (error) {
      console.warn('⚠️  WorkflowEngine.obtenerSesionActiva error:', error.message);
      return null;
    }

    return data || null;
  }

  /**
   * Retorna el nodo actual de una sesión.
   *
   * @param {Object} sesion — fila de workflow_sessions
   * @returns {Promise<Object|null>}
   */
  async obtenerNodoActual(sesion) {
    if (!sesion?.workflow_id || !sesion?.current_node) return null;

    const { data, error } = await this._db
      .from('workflow_nodes')
      .select('*')
      .eq('workflow_id', sesion.workflow_id)
      .eq('nombre', sesion.current_node)
      .maybeSingle();

    if (error) {
      console.warn('⚠️  WorkflowEngine.obtenerNodoActual error:', error.message);
      return null;
    }

    return data || null;
  }

  /**
   * Crea una nueva sesión de workflow para un cliente.
   * El cliente no puede tener otra sesión activa (índice único en DB).
   *
   * @param {string} company_id
   * @param {number} cliente_id
   * @param {number|null} conversation_id
   * @param {string} workflow_id
   * @returns {Promise<Object>}  — la sesión creada
   */
  async iniciarSesion(company_id, cliente_id, conversation_id, workflow_id) {
    const { data: nodoInicio, error: errorNodo } = await this._db
      .from('workflow_nodes')
      .select('nombre')
      .eq('workflow_id', workflow_id)
      .eq('es_inicio', true)
      .maybeSingle();

    if (errorNodo || !nodoInicio) {
      throw new Error(`WorkflowEngine: workflow ${workflow_id} no tiene nodo de inicio`);
    }

    const { data: sesion, error: errorSesion } = await this._db
      .from('workflow_sessions')
      .insert({
        company_id,
        cliente_id,
        conversation_id: conversation_id || null,
        workflow_id,
        current_node:    nodoInicio.nombre,
        status:          'activo',
      })
      .select()
      .single();

    if (errorSesion) {
      throw new Error(`WorkflowEngine.iniciarSesion: ${errorSesion.message}`);
    }

    return sesion;
  }

  /**
   * Avanza la sesión al siguiente nodo capturando el campo del nodo actual.
   * Si el nodo es final, marca la sesión como completada.
   *
   * @param {Object}      sesion  — fila de workflow_sessions
   * @param {Object}      nodo    — fila de workflow_nodes (nodo actual)
   * @param {string|null} valor   — respuesta del cliente (null si campo es_opcional)
   * @returns {Promise<{
   *   sesion:         Object,
   *   completado:     boolean,
   *   siguiente_nodo: Object|null
   * }>}
   */
  async avanzar(sesion, nodo, valor) {
    const nuevosCampos = { ...sesion.captured_fields };

    if (nodo.campo) {
      nuevosCampos[nodo.campo] = valor ?? null;
    }

    const esFin = nodo.es_fin || !nodo.siguiente_nodo;

    if (esFin) {
      const { data: sesionFinal, error } = await this._db
        .from('workflow_sessions')
        .update({
          captured_fields: nuevosCampos,
          status:          'completado',
          completed_at:    new Date().toISOString(),
          updated_at:      new Date().toISOString(),
          total_turnos:    (sesion.total_turnos || 0) + 1,
        })
        .eq('id', sesion.id)
        .select()
        .single();

      if (error) throw new Error(`WorkflowEngine.avanzar (fin): ${error.message}`);

      return { sesion: sesionFinal, completado: true, siguiente_nodo: null };
    }

    // Avanzar al siguiente nodo
    const { data: sesionActualizada, error: errorSesion } = await this._db
      .from('workflow_sessions')
      .update({
        captured_fields: nuevosCampos,
        current_node:    nodo.siguiente_nodo,
        updated_at:      new Date().toISOString(),
        total_turnos:    (sesion.total_turnos || 0) + 1,
      })
      .eq('id', sesion.id)
      .select()
      .single();

    if (errorSesion) throw new Error(`WorkflowEngine.avanzar: ${errorSesion.message}`);

    const { data: siguienteNodo, error: errorNodo } = await this._db
      .from('workflow_nodes')
      .select('*')
      .eq('workflow_id', sesion.workflow_id)
      .eq('nombre', nodo.siguiente_nodo)
      .maybeSingle();

    if (errorNodo) throw new Error(`WorkflowEngine.avanzar (nodo): ${errorNodo.message}`);

    return {
      sesion:         sesionActualizada,
      completado:     false,
      siguiente_nodo: siguienteNodo,
    };
  }

  /**
   * Abandona la sesión activa. Registra el nodo de abandono para métricas.
   *
   * @param {string} sesion_id
   * @param {string} nodo_actual — nombre del nodo donde se abandonó
   * @returns {Promise<Object>}
   */
  async abandonar(sesion_id, nodo_actual) {
    const { data, error } = await this._db
      .from('workflow_sessions')
      .update({
        status:        'abandonado',
        nodo_abandono: nodo_actual || null,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', sesion_id)
      .select()
      .single();

    if (error) {
      console.warn('⚠️  WorkflowEngine.abandonar error:', error.message);
      return null;
    }

    return data;
  }
}

module.exports = { WorkflowEngine };
