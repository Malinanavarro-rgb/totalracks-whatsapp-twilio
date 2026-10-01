/**
 * TARA Matrix™ — permisos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolida `ROLES_GERENCIALES`, duplicado hasta ahora en `agenda.js`,
 * `conversaciones.js`, `crm-ui.js`, `inbox.js` y `server.js` (deuda ya
 * documentada en la auditoría previa al Inbox Inteligente) — una sola
 * fuente de verdad de qué roles ven todo dentro de su empresa vs. solo lo
 * asignado a sí mismos.
 *
 * Roles departamentales (Alina, 2026-09-29, autorizado tras
 * NORT_ENERGY_AUDIT_V1.md sección 9 y NORT_ENERGY_P1_ENTREGA.md) — matriz
 * de permisos por rol/módulo/acción, DATO por empresa (migración 124),
 * nunca código. Diseño de dos niveles:
 *
 *   1. `esGerencial(rol)` (sin cambios) sigue siendo un bypass total —
 *      dirección/gerencia siempre ven y pueden todo, exactamente como hoy.
 *   2. `tienePermiso()` resuelve cualquier otro rol contra `roles_permisos`:
 *      - Empresa sin NINGUNA fila configurada → acceso total (comportamiento
 *        idéntico al de antes de esta migración — cero regresión para
 *        cualquier empresa de TARA que no haya optado por esto).
 *      - Empresa CON al menos una fila configurada → un hueco específico
 *        en la matriz es DENEGAR, nunca "todo permitido".
 *
 * @module modules/permisos
 */

'use strict';

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

// Documentados aquí (texto libre en la base, sin ENUM — agregar un módulo
// nuevo es agregar filas de dato, nunca una migración).
const MODULOS_PERMISOS = [
  'crm', 'cotizaciones', 'proyectos', 'cobranza', 'instalaciones', 'inventario',
  'compras', 'tramites_cfe', 'garantias', 'mantenimiento', 'tickets', 'configuracion',
];
const ACCIONES_PERMISOS = ['ver', 'crear', 'editar', 'eliminar', 'aprobar', 'exportar'];
const ALCANCES_PERMISOS = ['todos', 'sucursal', 'propios', 'asignados'];

/**
 * @param {string} rol
 * @returns {boolean}
 */
function esGerencial(rol) {
  return ROLES_GERENCIALES.includes(rol);
}

/** true si la empresa configuró AL MENOS una fila — decide cuál de los dos niveles de fallback aplica. */
async function _empresaTieneMatrizConfigurada(supabase, companyId) {
  const { data } = await supabase.from('roles_permisos').select('id').eq('company_id', companyId).limit(1).maybeSingle();
  return Boolean(data);
}

/**
 * Resuelve si `rol` puede hacer `accion` sobre `modulo` en `companyId`.
 * Gerencial siempre true (bypass). Sin matriz configurada en la empresa,
 * true (comportamiento previo a esta migración). Con matriz configurada,
 * depende de la fila real — sin fila, false.
 */
async function tienePermiso(supabase, { companyId, rol, modulo, accion }) {
  if (esGerencial(rol)) return true;
  if (!ACCIONES_PERMISOS.includes(accion)) throw new Error(`permisos.tienePermiso: acción "${accion}" no reconocida`);

  const { data: fila } = await supabase
    .from('roles_permisos').select('*').eq('company_id', companyId).eq('rol', rol).eq('modulo', modulo).maybeSingle();
  if (fila) return fila[accion] === true;

  return !(await _empresaTieneMatrizConfigurada(supabase, companyId));
}

/**
 * Módulos (de los 12 de MODULOS_PERMISOS) que `rol` puede VER en `companyId`
 * — para que el frontend (Shell.jsx) oculte del menú lo que el backend
 * negaría con 403, nunca al revés. Mismo criterio de fallback que
 * tienePermiso(): gerencial o empresa sin matriz configurada → todos los
 * módulos (cero restricción, igual que siempre); con matriz configurada,
 * solo los que tengan una fila con ver=true.
 */
async function modulosVisibles(supabase, { companyId, rol }) {
  if (esGerencial(rol)) return [...MODULOS_PERMISOS];
  if (!(await _empresaTieneMatrizConfigurada(supabase, companyId))) return [...MODULOS_PERMISOS];

  const { data: filas } = await supabase
    .from('roles_permisos').select('modulo, ver').eq('company_id', companyId).eq('rol', rol);
  return (filas || []).filter((f) => f.ver === true).map((f) => f.modulo);
}

/** El alcance configurado para (rol, módulo) — 'todos' si no hay matriz configurada en la empresa (mismo criterio de fallback que tienePermiso). */
async function resolverAlcance(supabase, { companyId, rol, modulo }) {
  if (esGerencial(rol)) return 'todos';
  const { data: fila } = await supabase
    .from('roles_permisos').select('alcance').eq('company_id', companyId).eq('rol', rol).eq('modulo', modulo).maybeSingle();
  if (fila) return fila.alcance;
  return (await _empresaTieneMatrizConfigurada(supabase, companyId)) ? 'propios' : 'todos';
}

/**
 * Middleware Express — requiere sesión ya resuelta (después de
 * requireAuth). 403 con mensaje claro si no tiene el permiso; nunca
 * revela si el módulo existe o no, mismo mensaje para "no tienes permiso"
 * en cualquier caso de negación.
 */
function requirePermiso(modulo, accion) {
  return async function (req, res, next) {
    try {
      const permitido = await tienePermiso(req.supabase, { companyId: req.usuario.company_id, rol: req.usuario.rol, modulo, accion });
      if (!permitido) return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

module.exports = {
  ROLES_GERENCIALES, MODULOS_PERMISOS, ACCIONES_PERMISOS, ALCANCES_PERMISOS,
  esGerencial, tienePermiso, resolverAlcance, requirePermiso, modulosVisibles,
};
