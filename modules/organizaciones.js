/**
 * TARA Matrix™ — organizaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. `organizations` es el sujeto del
 * contrato/billing (Constitución Art. 9/16) — nunca `companies` directo.
 *
 * Único camino de escritura: `crearOrganizacionConCompany()` es la ÚNICA
 * función de todo el código que debe insertar en `companies` a partir de
 * ahora — evita repetir el patrón de permisos fragmentados ya documentado
 * como deuda (ROLES_GERENCIALES definido de forma independiente en 3
 * módulos distintos).
 *
 * @module modules/organizaciones
 */

'use strict';

/**
 * Crea una Organization y su primera Company en el mismo flujo. No hay
 * transacción explícita (Supabase JS no la soporta vía REST) — mismo
 * criterio ya usado en plantillas-industria.js::crearEmpresaConIndustria():
 * inserts secuenciales, con un best-effort de limpieza si el segundo falla.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - cliente service_role
 * @param {{nombre: string, descripcion?: string, slug: string, industriaSlug?: string, creadoPor?: string}} datos
 * @returns {Promise<{organization: Object, company: Object}>}
 */
async function crearOrganizacionConCompany(supabase, { nombre, descripcion, slug, industriaSlug, creadoPor }) {
  const { data: organization, error: errOrg } = await supabase
    .from('organizations')
    .insert([{ nombre, created_by: creadoPor || null }])
    .select()
    .single();

  if (errOrg) throw new Error(`organizaciones.crearOrganizacionConCompany: ${errOrg.message}`);

  const { data: company, error: errCompany } = await supabase
    .from('companies')
    .insert([{
      nombre, slug, estado: 'activo',
      descripcion: descripcion || null,
      industria_slug: industriaSlug || null,
      organization_id: organization.id,
    }])
    .select()
    .single();

  if (errCompany) {
    await supabase.from('organizations').delete().eq('id', organization.id);
    throw new Error(`organizaciones.crearOrganizacionConCompany: ${errCompany.message}`);
  }

  return { organization, company };
}

async function listarOrganizaciones(supabase) {
  const { data, error } = await supabase
    .from('organizations')
    .select('*, companies(id, nombre, estado, industria_slug)')
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

async function obtenerOrganizacion(supabase, organizationId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('*, companies(id, nombre, estado, industria_slug, created_at)')
    .eq('id', organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

module.exports = { crearOrganizacionConCompany, listarOrganizaciones, obtenerOrganizacion };
