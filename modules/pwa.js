/**
 * TARA Matrix™ — pwa.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manifest de la PWA instalable (Alina, 2026-10-04) — mismo panel, instalable
 * desde el navegador en el teléfono, con la marca de CADA empresa cuando la
 * configuró (companies.pwa_icon_url, migración 125).
 *
 * Motor Universal: sin pwa_icon_url configurado, manifest genérico TARA-OS —
 * el mismo que ya se servía antes de esto (vite-plugin-pwa lo generaba
 * estático en build). Cero regresión para cualquier empresa del SaaS que no
 * haya subido su propio ícono.
 *
 * pwa_icon_url debe ser un PNG ya cuadrado (512x512) — companies.logo_url NO
 * sirve directo para esto, casi ningún logo real es cuadrado y el sistema
 * operativo lo recorta/distorsiona al usarlo como ícono de app.
 *
 * @module modules/pwa
 */

'use strict';

const MANIFEST_BASE = Object.freeze({
  short_name: 'TARA-OS',
  name: 'TARA-OS — Panel',
  description: 'Panel operativo de TARA-OS: conversaciones, agenda, CRM y más.',
  start_url: '/operaciones',
  display: 'standalone',
  background_color: '#fafbfc',
  theme_color: '#0F766E',
  lang: 'es',
  scope: '/',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|undefined} companyId - de la cookie tara_company; puede no existir (visitante sin sesión)
 * @returns {Promise<Object>} manifest.webmanifest — genérico si no hay empresa o no configuró ícono propio
 */
async function generarManifestParaEmpresa(supabase, companyId) {
  if (!companyId) return MANIFEST_BASE;

  const { data: company } = await supabase
    .from('companies').select('nombre, pwa_icon_url, color_acento').eq('id', companyId).maybeSingle();
  if (!company?.pwa_icon_url) return MANIFEST_BASE;

  return {
    ...MANIFEST_BASE,
    name: company.nombre || MANIFEST_BASE.name,
    short_name: (company.nombre || MANIFEST_BASE.short_name).slice(0, 30),
    theme_color: company.color_acento || MANIFEST_BASE.theme_color,
    icons: [
      { src: company.pwa_icon_url, sizes: '192x192', type: 'image/png' },
      { src: company.pwa_icon_url, sizes: '512x512', type: 'image/png' },
      { src: company.pwa_icon_url, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

module.exports = { MANIFEST_BASE, generarManifestParaEmpresa };
