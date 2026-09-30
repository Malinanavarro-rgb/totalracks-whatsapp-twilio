/**
 * TARA Matrix™ — Nort Energy, matriz de roles departamentales (Alina,
 * 2026-09-29, ver NORT_ENERGY_AUDIT_V1.md sección 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Siembra `roles_permisos` (migración 124) con la matriz completa
 * propuesta en la auditoría — 7 roles operativos × los módulos donde cada
 * uno tiene algo que hacer. `owner`/`administrador`/`supervisor` NO se
 * siembran aquí — siempre tienen bypass total vía esGerencial(), nunca
 * pasan por esta tabla.
 *
 * Verificado antes de correr: Nort Energy hoy tiene un único usuario real
 * y su rol es 'owner' (bypass total) — sembrar esto no bloquea a nadie
 * hoy. Solo toma efecto de verdad para un usuario nuevo al que se le
 * asigne uno de estos 7 roles.
 *
 * IMPORTANTE — alcance de la aplicación real (ver NORT_ENERGY_P1_ENTREGA.md):
 * el middleware requirePermiso() SOLO está aplicado hoy en las rutas de
 * Compras e Inventario. Los demás módulos de esta matriz (proyectos,
 * cobranza, instalaciones, tramites_cfe, garantias, mantenimiento,
 * tickets, crm, cotizaciones, configuracion) quedan sembrados como DATO
 * listo, pero sin ningún endpoint que todavía los consulte — extenderlos
 * es agregar `requirePermiso(modulo, accion)` a cada ruta, sin tocar esta
 * tabla de nuevo.
 *
 * Uso: node scripts/nort-energy-roles-permisos.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

// V=ver C=crear E=editar El=eliminar A=aprobar Ex=exportar — building blocks legibles.
function fila(rol, modulo, { V = false, C = false, E = false, El = false, A = false, Ex = false, alcance = 'propios' } = {}) {
  return { company_id: COMPANY_ID, rol, modulo, ver: V, crear: C, editar: E, eliminar: El, aprobar: A, exportar: Ex, alcance };
}

const MATRIZ = [
  // ── VENTAS ──────────────────────────────────────────────────────────────
  fila('ventas', 'crm', { V: true, C: true, E: true, alcance: 'propios' }),
  fila('ventas', 'cotizaciones', { V: true, C: true, E: true, alcance: 'propios' }),
  fila('ventas', 'proyectos', { V: true, alcance: 'propios' }),
  fila('ventas', 'cobranza', { V: true, alcance: 'propios' }),
  fila('ventas', 'tickets', { V: true, alcance: 'propios' }),

  // ── INGENIERÍA ──────────────────────────────────────────────────────────
  fila('ingenieria', 'crm', { V: true, alcance: 'todos' }),
  fila('ingenieria', 'cotizaciones', { V: true, C: true, E: true, alcance: 'todos' }),
  fila('ingenieria', 'proyectos', { V: true, alcance: 'todos' }),
  fila('ingenieria', 'instalaciones', { V: true, alcance: 'todos' }),

  // ── ADMINISTRACIÓN / COBRANZA ─────────────────────────────────────────
  fila('administracion', 'crm', { V: true, alcance: 'todos' }),
  fila('administracion', 'cotizaciones', { V: true, alcance: 'todos' }),
  fila('administracion', 'proyectos', { V: true, C: true, E: true, alcance: 'todos' }),
  fila('administracion', 'cobranza', { V: true, C: true, E: true, A: true, alcance: 'todos' }),
  fila('administracion', 'instalaciones', { V: true, alcance: 'todos' }),
  fila('administracion', 'inventario', { V: true, alcance: 'todos' }),
  fila('administracion', 'compras', { V: true, C: true, A: true, alcance: 'todos' }),
  fila('administracion', 'tickets', { V: true, alcance: 'todos' }),

  // ── INSTALACIONES ───────────────────────────────────────────────────────
  fila('instalaciones', 'proyectos', { V: true, alcance: 'asignados' }),
  fila('instalaciones', 'instalaciones', { V: true, C: true, E: true, alcance: 'asignados' }),
  fila('instalaciones', 'inventario', { V: true, C: true, alcance: 'asignados' }), // reservar/consumir material de SU instalación
  fila('instalaciones', 'mantenimiento', { V: true, C: true, alcance: 'asignados' }),

  // ── ALMACÉN ──────────────────────────────────────────────────────────────
  fila('almacen', 'inventario', { V: true, C: true, E: true, El: true, alcance: 'todos' }),
  fila('almacen', 'compras', { V: true, C: true, alcance: 'todos' }),

  // ── CFE ──────────────────────────────────────────────────────────────────
  fila('cfe', 'proyectos', { V: true, alcance: 'todos' }),
  fila('cfe', 'tramites_cfe', { V: true, C: true, E: true, alcance: 'todos' }),

  // ── POSTVENTA ────────────────────────────────────────────────────────────
  fila('postventa', 'proyectos', { V: true, alcance: 'todos' }),
  fila('postventa', 'garantias', { V: true, C: true, E: true, alcance: 'todos' }),
  fila('postventa', 'mantenimiento', { V: true, C: true, E: true, alcance: 'todos' }),
  fila('postventa', 'tickets', { V: true, C: true, E: true, alcance: 'todos' }),
];

(async () => {
  // Idempotente: borra la matriz previa de Nort Energy (si la hay) y
  // vuelve a insertar completa — evita filas huérfanas de una corrida
  // anterior con un diseño distinto.
  const { error: errBorrar } = await supabase.from('roles_permisos').delete().eq('company_id', COMPANY_ID);
  if (errBorrar) {
    console.error('❌ Error limpiando matriz previa:', errBorrar.message);
    process.exit(1);
  }

  const { error: errInsertar } = await supabase.from('roles_permisos').insert(MATRIZ);
  if (errInsertar) {
    console.error('❌ Error insertando la matriz:', errInsertar.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — matriz de roles departamentales sembrada: ${MATRIZ.length} filas (7 roles).`);
  console.log('   Hoy solo se hace cumplir en Compras e Inventario — ver NORT_ENERGY_P1_ENTREGA.md para el resto.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
