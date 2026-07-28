/**
 * TARA Matrix™ — cuenta-plataforma
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR-012: capa de SERVICIO que le da al Asistente Oficial de TARA-OS acceso
 * a datos reales de la cuenta de quien le escribe (plan, suscripción,
 * integraciones activas, tickets de soporte) — nunca embebidos en el
 * prompt como texto estático. El prompt (personalities de la empresa
 * TARA-OS) solo define CÓMO hablar de esto; los datos siempre vienen de
 * aquí, en tiempo real, en cada mensaje.
 *
 * Diseño explícito para crecer sin volver a tocar el flujo de conversación
 * (Orchestrator/PromptBuilder): cada capacidad nueva de la plataforma
 * (facturación, licencias, estado de implementación, monitoreo) es una
 * función más en este módulo con la misma forma de retorno —
 * `{ disponible: boolean, ... }` — y `construirResumenCuentaParaKnowledge()`
 * es el único punto que el Core conoce (vía el dep opcional
 * `obtenerEnriquecimientoCuenta` de Orchestrator). Agregar una capacidad
 * real más adelante es implementar su función aquí, nunca reabrir
 * orchestrator.js ni prompt-builder.js.
 *
 * Nunca inventa datos: cuando una capacidad todavía no está construida
 * (facturación, estado de implementación, monitoreo — ver ADR-012), la
 * función respectiva devuelve `disponible: false` con un `motivo` honesto,
 * en vez de simular una respuesta.
 *
 * @module modules/cuenta-plataforma
 */

'use strict';

const { obtenerSuscripcionVigente } = require('./plataforma-billing');

// ═════════════════════════════════════════════════════════════════════════════
// RESOLUCIÓN DE CUENTA — teléfono entrante → usuario/empresas de TARA-OS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resuelve qué usuario de la plataforma (y qué empresas administra) es
 * dueño de un número de teléfono — el bridge que faltaba para que el
 * Asistente Oficial sepa "quién me escribe" más allá del cliente-final de
 * una empresa tenant (que es lo único que `clientes.telefono` resuelve hoy).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} telefono
 * @returns {Promise<{usuario: Object, empresas: Array<{company_id: string, nombre: string, rol: string, organization_id: string}>}|null>}
 *   null si el teléfono no está vinculado a ningún usuario de la plataforma
 *   (caso normal: la inmensa mayoría de quienes escriben son prospectos).
 */
async function resolverCuentaPorTelefono(supabase, telefono) {
  if (!telefono) return null;

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email')
    .eq('telefono', telefono)
    .eq('activo', true)
    .maybeSingle();

  if (error || !usuario) return null;

  const { data: filas } = await supabase
    .from('usuarios_empresas')
    .select('company_id, rol, companies(nombre, organization_id)')
    .eq('usuario_id', usuario.id)
    .eq('activo', true);

  const empresas = (filas || []).map(f => ({
    company_id:      f.company_id,
    nombre:          f.companies?.nombre || null,
    rol:             f.rol,
    organization_id: f.companies?.organization_id || null,
  }));

  return { usuario, empresas };
}

// ═════════════════════════════════════════════════════════════════════════════
// CAPACIDADES YA CONSTRUIDAS — datos reales, no interfaces
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resumen honesto del plan/suscripción vigente de una organización.
 * Reusa obtenerSuscripcionVigente() (modules/plataforma-billing.js) — único
 * punto de lectura de `suscripciones` ya existente, no se duplica lógica.
 *
 * @returns {Promise<{disponible: boolean, plan?: string, estado?: string, periodo?: string, fecha_fin_prueba?: string|null, proximo_cobro?: string|null, motivo?: string}>}
 */
async function obtenerResumenSuscripcion(supabase, organizationId) {
  if (!organizationId) return { disponible: false, motivo: 'No se pudo identificar la organización de esta cuenta.' };

  const suscripcion = await obtenerSuscripcionVigente(supabase, organizationId);
  if (!suscripcion) return { disponible: false, motivo: 'Esta organización no tiene una suscripción registrada todavía.' };

  return {
    disponible:       true,
    plan:             suscripcion.planes?.nombre || null,
    estado:           suscripcion.estado,
    periodo:          suscripcion.planes?.periodo || null,
    fecha_fin_prueba: suscripcion.fecha_prueba_fin || null,
    proximo_cobro:    suscripcion.fecha_periodo_actual_fin || null,
  };
}

/**
 * Vista consolidada de integraciones activas — hoy dispersas en una tabla
 * por integración (calendar_credentials, meta_whatsapp_credentials), sin
 * vista única. Agregar una integración nueva en el futuro es un `SELECT`
 * más aquí, nunca un cambio de contrato para quien llama a esta función.
 *
 * @returns {Promise<Array<{tipo: string, activo: boolean, detalle?: string}>>}
 */
async function obtenerIntegracionesActivas(supabase, companyId) {
  if (!companyId) return [];

  const [{ data: calendar }, { data: metaWhatsapp }] = await Promise.all([
    supabase.from('calendar_credentials').select('proveedor, activo').eq('company_id', companyId).eq('activo', true).maybeSingle(),
    supabase.from('meta_whatsapp_credentials').select('estado, activo').eq('company_id', companyId).eq('activo', true).maybeSingle(),
  ]);

  const integraciones = [];
  integraciones.push({ tipo: 'google_calendar', activo: !!calendar, detalle: calendar?.proveedor || null });
  integraciones.push({ tipo: 'whatsapp_meta', activo: !!metaWhatsapp, detalle: metaWhatsapp?.estado || null });
  return integraciones;
}

/**
 * Tickets de soporte abiertos/en proceso de una organización — más
 * recientes primero.
 */
async function listarTicketsAbiertos(supabase, organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('tickets_soporte')
    .select('id, asunto, estado, prioridad, created_at')
    .eq('organization_id', organizationId)
    .in('estado', ['abierto', 'en_proceso'])
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

/**
 * Crea un ticket de soporte real — usado por la acción `crear_ticket_soporte`
 * del ActionRunner (ver crearOrchestrator() en modules/orchestrator.js).
 * Nunca lo crea el modelo directamente: el modelo solo PROPONE la acción
 * (acciones_propuestas), este servicio es quien de verdad escribe en la DB.
 *
 * @returns {Promise<{id: string}>}
 */
async function crearTicket(supabase, { organizationId, usuarioId, asunto, descripcion, prioridad, canal }) {
  if (!organizationId) throw new Error('crearTicket: organizationId es requerido');
  if (!asunto) throw new Error('crearTicket: asunto es requerido');

  const { data, error } = await supabase
    .from('tickets_soporte')
    .insert({
      organization_id: organizationId,
      usuario_id:      usuarioId || null,
      asunto,
      descripcion:     descripcion || null,
      prioridad:       prioridad || 'media',
      canal:           canal || 'whatsapp',
    })
    .select('id')
    .single();

  if (error) throw new Error(`crearTicket: ${error.message}`);
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// INTERFACES TODAVÍA NO CONSTRUIDAS — mismo contrato, sin datos inventados
// ═════════════════════════════════════════════════════════════════════════════
// Cuando estos módulos existan de verdad (facturación/pagos, monitoreo de
// implementación), se reemplaza el cuerpo de la función respectiva por una
// consulta real — el contrato { disponible, motivo } no cambia, así que
// nada que llame a estas funciones (ni el prompt) necesita modificarse.

/** @returns {Promise<{disponible: false, motivo: string}>} */
async function obtenerFacturas(_supabase, _organizationId) {
  return { disponible: false, motivo: 'El módulo de facturación todavía no está conectado a este canal.' };
}

/** @returns {Promise<{disponible: false, motivo: string}>} */
async function obtenerEstadoImplementacion(_supabase, _companyId) {
  return { disponible: false, motivo: 'El seguimiento de estado de implementación todavía no está conectado a este canal.' };
}

/** @returns {Promise<{disponible: false, motivo: string}>} */
async function obtenerMonitoreoServicio(_supabase, _companyId) {
  return { disponible: false, motivo: 'El monitoreo de servicio todavía no está conectado a este canal.' };
}

// ═════════════════════════════════════════════════════════════════════════════
// PUNTO DE ENTRADA ÚNICO PARA EL CORE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Único punto que Orchestrator conoce (vía el dep opcional
 * `obtenerEnriquecimientoCuenta`) — arma el resumen de cuenta real como una
 * entrada más de knowledge_base (mismo formato {categoria, contenido} que
 * ya consume PromptBuilder), o `null` si el teléfono no resuelve a ninguna
 * cuenta de la plataforma (caso normal para prospectos).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId - de la empresa que recibe el mensaje (TARA-OS)
 * @param {string} telefono - message.from
 * @returns {Promise<Array<{categoria: string, contenido: string}>>}
 */
async function construirResumenCuentaParaKnowledge(supabase, companyId, telefono) {
  const cuenta = await resolverCuentaPorTelefono(supabase, telefono);
  if (!cuenta) return [];

  const partes = [`El número que escribe pertenece a ${cuenta.usuario.nombre || cuenta.usuario.email}, usuario real de la plataforma TARA-OS.`];

  if (cuenta.empresas.length === 0) {
    partes.push('No administra ninguna empresa activa en la plataforma todavía.');
  }

  for (const empresa of cuenta.empresas) {
    partes.push(`\nEmpresa: ${empresa.nombre} (rol: ${empresa.rol}).`);

    const suscripcion = await obtenerResumenSuscripcion(supabase, empresa.organization_id);
    partes.push(suscripcion.disponible
      ? `Plan: ${suscripcion.plan} — estado: ${suscripcion.estado}${suscripcion.proximo_cobro ? `, próximo cobro: ${suscripcion.proximo_cobro}` : ''}.`
      : `Plan/suscripción: ${suscripcion.motivo}`);

    const integraciones = await obtenerIntegracionesActivas(supabase, empresa.company_id);
    const activas = integraciones.filter(i => i.activo).map(i => i.tipo);
    partes.push(activas.length > 0 ? `Integraciones activas: ${activas.join(', ')}.` : 'Sin integraciones activas todavía.');

    const tickets = await listarTicketsAbiertos(supabase, empresa.organization_id);
    partes.push(tickets.length > 0
      ? `Tickets de soporte abiertos: ${tickets.map(t => `"${t.asunto}" (${t.prioridad})`).join('; ')}.`
      : 'Sin tickets de soporte abiertos.');
  }

  return [{ categoria: 'CUENTA_REAL_DEL_CONTACTO', contenido: partes.join('\n') }];
}

module.exports = {
  resolverCuentaPorTelefono,
  obtenerResumenSuscripcion,
  obtenerIntegracionesActivas,
  listarTicketsAbiertos,
  crearTicket,
  obtenerFacturas,
  obtenerEstadoImplementacion,
  obtenerMonitoreoServicio,
  construirResumenCuentaParaKnowledge,
};
