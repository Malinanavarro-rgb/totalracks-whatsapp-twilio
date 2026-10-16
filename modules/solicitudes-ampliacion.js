/**
 * TARA Matrix™ — solicitudes-ampliacion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 3.4 (migración 131). Una empresa solicita un
 * módulo que su plan no incluye; el Super Admin la revisa manualmente
 * desde Panel Maestro — mismo criterio que
 * modules/plataforma-billing.js::crearSuscripcionManual() (sin gateway de
 * pago conectado, nunca cobra ni factura automáticamente).
 *
 * Aprobar una solicitud de módulo escribe en modulos_empresa como una
 * excepción puntual de ESA empresa — nunca modifica planes.limites (eso
 * afectaría a todas las empresas de ese plan, no es lo que pidió esta).
 *
 * @module modules/solicitudes-ampliacion
 */

'use strict';

async function crearSolicitud(supabase, { companyId, organizationId, moduloCodigo, notas, solicitadoPor }) {
  // No duplicar una solicitud pendiente del mismo módulo (pedido explícito) —
  // solo aplica cuando hay un módulo específico; una ampliación general
  // (moduloCodigo null) no tiene con qué compararse, se permite siempre.
  if (moduloCodigo) {
    const { data: existente } = await supabase
      .from('solicitudes_ampliacion')
      .select('id')
      .eq('company_id', companyId)
      .eq('modulo_codigo', moduloCodigo)
      .eq('estado', 'pendiente')
      .maybeSingle();
    if (existente) {
      const e = new Error('Ya tienes una solicitud pendiente para este módulo.');
      e.status = 409;
      throw e;
    }
  }

  const { data, error } = await supabase
    .from('solicitudes_ampliacion')
    .insert([{
      company_id: companyId, organization_id: organizationId,
      modulo_codigo: moduloCodigo || null, notas: notas || null,
      solicitado_por: solicitadoPor, estado: 'pendiente',
    }])
    .select()
    .single();

  if (error) throw new Error(`solicitudes-ampliacion.crearSolicitud: ${error.message}`);
  return data;
}

async function listarSolicitudes(supabase, { estado, companyId } = {}) {
  let query = supabase
    .from('solicitudes_ampliacion')
    .select('*, companies(nombre), modulos_catalogo(nombre)')
    .order('created_at', { ascending: false });
  if (estado) query = query.eq('estado', estado);
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function revisarSolicitud(supabase, id, { aprobar, revisadoPor, notasRevision }) {
  const { data: solicitud, error: errLeer } = await supabase.from('solicitudes_ampliacion').select('*').eq('id', id).maybeSingle();
  if (errLeer || !solicitud) throw new Error('Solicitud no encontrada');
  if (solicitud.estado !== 'pendiente') throw new Error('Esta solicitud ya fue revisada');

  const { data, error } = await supabase
    .from('solicitudes_ampliacion')
    .update({
      estado: aprobar ? 'aprobada' : 'rechazada',
      revisada_por: revisadoPor,
      revisada_en: new Date().toISOString(),
      notas_revision: notasRevision || null,
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar la solicitud');

  if (aprobar && solicitud.modulo_codigo) {
    const { error: errActivar } = await supabase.from('modulos_empresa').upsert(
      { company_id: solicitud.company_id, modulo_codigo: solicitud.modulo_codigo, estado: 'activo', activado_en: new Date().toISOString(), activado_por: revisadoPor },
      { onConflict: 'company_id,modulo_codigo' },
    );
    if (errActivar) throw new Error(`solicitudes-ampliacion.revisarSolicitud: la solicitud se marcó aprobada pero no se pudo activar el módulo: ${errActivar.message}`);
  }

  return data;
}

module.exports = { crearSolicitud, listarSolicitudes, revisarSolicitud };
