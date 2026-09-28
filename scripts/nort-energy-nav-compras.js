/**
 * TARA Matrix™ — Nort Energy, nav "Compras" (Alina, 2026-09-25)
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2G ya tiene página real (/compras, /compras/:id) — se agrega el
 * módulo de navegación a nav_labels.modulos con habilitado:true. Los demás
 * módulos de fases futuras (Instalaciones, Trámites CFE, Cobranza,
 * Inventario, Garantías, Tickets, Reportes) se quedan exactamente como
 * están — habilitado:false hasta que cada uno tenga su propia página real
 * (mismo criterio que scripts/nort-energy-fase1-nav-dashboard.js).
 *
 * Read-modify-write (nunca overwrite ciego): lee nav_labels.modulos actual,
 * agrega/actualiza SOLO la entrada de /compras, deja todo lo demás intacto.
 *
 * Uso: node scripts/nort-energy-nav-compras.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

const MODULO_COMPRAS = { ruta: '/compras', etiqueta: 'Compras', icono: 'catalogo', habilitado: true, grupo: 'ADMINISTRACIÓN' };

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) {
    console.error('❌ Error leyendo Nort Energy:', errLeer.message);
    process.exit(1);
  }

  const modulosActuales = company?.nav_labels?.modulos || [];
  const yaExiste = modulosActuales.some((m) => m.ruta === '/compras');
  // Se inserta justo después de /inventario (mismo grupo ADMINISTRACIÓN) si
  // existe esa entrada; si no, al final — nunca reordena lo demás.
  const idxInventario = modulosActuales.findIndex((m) => m.ruta === '/inventario');
  const modulosNuevos = yaExiste
    ? modulosActuales.map((m) => (m.ruta === '/compras' ? MODULO_COMPRAS : m))
    : (idxInventario === -1
      ? [...modulosActuales, MODULO_COMPRAS]
      : [...modulosActuales.slice(0, idxInventario + 1), MODULO_COMPRAS, ...modulosActuales.slice(idxInventario + 1)]);

  const navLabels = { ...(company?.nav_labels || {}), modulos: modulosNuevos };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — módulo "Compras" ${yaExiste ? 'actualizado' : 'agregado'} en nav_labels.modulos (habilitado).`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
