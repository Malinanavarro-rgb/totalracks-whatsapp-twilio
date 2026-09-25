/**
 * TARA Matrix™ — Nort Energy: checklist de instalación
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2C (Alina, 2026-09-23) — el checklist de instalación es contenido
 * configurable por empresa (`checklists_config`), no código. Este script
 * carga el checklist que Alina dio como ejemplo en su especificación —
 * exclusivo de Nort Energy, no toca ninguna otra empresa ni el motor.
 *
 * Idempotente: es un upsert por (company_id, tipo) — correrlo de nuevo
 * simplemente reemplaza los items con esta misma lista.
 *
 * Uso: node scripts/nort-energy-checklist-instalacion.js
 */

'use strict';

require('dotenv').config();
const { supabaseServicio: supabase } = require('../modules/clients');
const { guardarChecklistConfig } = require('../modules/instalaciones');

const ITEMS = [
  { clave: 'confirmar_direccion', etiqueta: 'Confirmar dirección' },
  { clave: 'confirmar_cliente', etiqueta: 'Confirmar cliente' },
  { clave: 'revisar_techo', etiqueta: 'Revisar techo' },
  { clave: 'revisar_orientacion', etiqueta: 'Revisar orientación' },
  { clave: 'revisar_sombras', etiqueta: 'Revisar sombras' },
  { clave: 'revisar_centro_carga', etiqueta: 'Revisar centro de carga' },
  { clave: 'validar_voltaje', etiqueta: 'Validar voltaje' },
  { clave: 'validar_alimentacion', etiqueta: 'Validar alimentación' },
  { clave: 'material_completo', etiqueta: 'Material completo' },
  { clave: 'estructura', etiqueta: 'Estructura' },
  { clave: 'paneles', etiqueta: 'Paneles' },
  { clave: 'inversor_microinversores', etiqueta: 'Inversor/microinversores' },
  { clave: 'protecciones', etiqueta: 'Protecciones' },
  { clave: 'cableado', etiqueta: 'Cableado' },
  { clave: 'puesta_a_tierra', etiqueta: 'Puesta a tierra' },
  { clave: 'configuracion', etiqueta: 'Configuración' },
  { clave: 'pruebas', etiqueta: 'Pruebas' },
  { clave: 'fotografias', etiqueta: 'Fotografías' },
  { clave: 'limpieza', etiqueta: 'Limpieza' },
  { clave: 'firma_entrega', etiqueta: 'Firma/entrega' },
];

(async () => {
  const { data: empresa, error } = await supabase.from('companies').select('id, nombre').ilike('nombre', '%Nort Energy%').maybeSingle();
  if (error) throw new Error(error.message);
  if (!empresa) throw new Error('No se encontró Nort Energy');

  await guardarChecklistConfig(supabase, empresa.id, 'instalacion', ITEMS);
  console.log(`✅ Checklist de instalación cargado para Nort Energy (${ITEMS.length} ítems).`);
})().catch((err) => { console.error('❌', err.message); process.exit(1); });
