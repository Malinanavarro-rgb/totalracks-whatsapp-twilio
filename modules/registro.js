/**
 * TARA Matrix™ — registro.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Portal de Cliente — registro público (self-signup). Antes de esto, la
 * única forma de crear una empresa era que Alina la diera de alta a mano
 * (scripts/crear-empresa.js) o que un Super Admin la creara desde el Panel
 * Maestro (modules/organizaciones.js, requireAdmin). Este módulo es el
 * primer camino de autoservicio: un visitante se registra solo.
 *
 * Reusa, sin reescribir, lo que ya existía:
 *   - crearEmpresaConIndustria() (plantillas-industria.js) — crea
 *     Organization+Company y siembra personalidad/KB/servicios/pipeline/
 *     workflow según el giro detectado.
 *   - crearSuscripcionManual() (plataforma-billing.js) — arranca el plan
 *     Launch (prueba) para la organización nueva.
 *
 * El rol de quien se registra SIEMPRE es 'owner', hardcodeado aquí — nunca
 * se lee de la petición (mismo principio de seguridad que el alcance de
 * Modo Operador: lo decide el servidor, nunca el cliente).
 *
 * @module modules/registro
 */

'use strict';

const { crearEmpresaConIndustria } = require('./plantillas-industria');
const { crearSuscripcionManual } = require('./plataforma-billing');

class ErrorRegistro extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function generarSlug(nombre) {
  return (nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseServicio
 * @param {{nombreNegocio: string, descripcionNegocio?: string, nombreUsuario?: string, email: string, password: string}} datos
 * @returns {Promise<{usuarioId: string, email: string, companyId: string, organizationId: string}>}
 */
async function registrarEmpresa(supabaseServicio, { nombreNegocio, descripcionNegocio, nombreUsuario, email, password }) {
  if (!nombreNegocio?.trim() || !email?.trim() || !password) {
    throw new ErrorRegistro('nombreNegocio, email y password son requeridos', 400);
  }
  if (password.length < 8) {
    throw new ErrorRegistro('La contraseña debe tener al menos 8 caracteres', 400);
  }

  const { data: signUpData, error: errSignUp } = await supabaseServicio.auth.signUp({ email: email.trim(), password });
  if (errSignUp || !signUpData?.user) {
    // Supabase ya responde "User already registered" si el email existe —
    // cubre el caso de registro duplicado sin necesitar una consulta aparte.
    throw new ErrorRegistro(errSignUp?.message || 'No se pudo crear la cuenta', 400);
  }
  const usuarioId = signUpData.user.id;

  // Confirma el correo de inmediato — sin esto, el login posterior falla si
  // el proyecto de Supabase exige confirmación por correo (mismo ajuste que
  // se necesitó para una invitación consumida esta sesión). El registro es
  // nuestro propio flujo de negocio, no anónimo público sin control.
  await supabaseServicio.auth.admin.updateUserById(usuarioId, { email_confirm: true });

  const slug = `${generarSlug(nombreNegocio)}-${usuarioId.slice(0, 8)}`;
  const { organization, company } = await crearEmpresaConIndustria(supabaseServicio, {
    nombre: nombreNegocio.trim(),
    descripcionNegocio: descripcionNegocio?.trim() || nombreNegocio.trim(),
    slug,
  });

  await supabaseServicio.from('usuarios').insert([{ id: usuarioId, email: email.trim(), nombre: nombreUsuario?.trim() || null }]);

  // rol SIEMPRE 'owner' — nunca tomado de la petición.
  await supabaseServicio.from('usuarios_empresas').insert([{ usuario_id: usuarioId, company_id: company.id, rol: 'owner', activo: true }]);

  const { data: planLaunch } = await supabaseServicio.from('planes').select('id').eq('clave', 'launch').maybeSingle();
  if (planLaunch) {
    await crearSuscripcionManual(supabaseServicio, { organizationId: organization.id, planId: planLaunch.id });
  }

  return { usuarioId, email: email.trim(), companyId: company.id, organizationId: organization.id };
}

module.exports = { registrarEmpresa, ErrorRegistro };
