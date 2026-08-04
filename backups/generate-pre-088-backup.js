#!/usr/bin/env node
/**
 * Backup pre-migración 088 (Ingeniería y Cotización, Fase 1).
 * Mismo patrón que backups/generate-pre-fase3-backup.js — capturar schema
 * y datos de las tablas que la migración TOCA (ALTER) antes de aplicarla,
 * para poder confirmar después que nada existente se perdió o cambió.
 *
 * 088 no borra ninguna tabla ni fila existente — solo agrega columnas
 * (ADD COLUMN IF NOT EXISTS) y crea tablas nuevas. El único cambio
 * estructural sobre datos existentes es en `cotizaciones`: se reemplaza
 * el CHECK de `estado` y su DEFAULT. Por eso este backup vuelca
 * `cotizaciones` completa (fila por fila) además de conteos del resto.
 *
 * Uso: node backups/generate-pre-088-backup.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_ANON_KEY en .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BACKUP_DIR = path.join(__dirname);
const TIMESTAMP = new Date().toISOString();

const TABLAS_ALTERADAS = ['cotizaciones', 'proyectos', 'seguimientos', 'clientes', 'plantillas_industria', 'companies'];

async function main() {
  console.log('\n📦 Generando backup pre-088...');
  console.log(`Timestamp: ${TIMESTAMP}\n`);

  const schemaLines = [`# TARA-OS — Schema pre-migración 088 (Ingeniería y Cotización, Fase 1)\n# Generado: ${TIMESTAMP}\n`];

  for (const tabla of TABLAS_ALTERADAS) {
    const { data, error } = await supabase.from(tabla).select('*').limit(1);
    if (error) {
      schemaLines.push(`\n## ${tabla}\n  ERROR: ${error.message}`);
      console.log(`  ⚠️  ${tabla}: ${error.message}`);
      continue;
    }
    const columnas = data && data.length > 0 ? Object.keys(data[0]).join(', ') : '(tabla vacía — columnas no disponibles sin filas)';
    schemaLines.push(`\n## ${tabla}\n  Columnas: ${columnas}`);
    console.log(`  ✅ ${tabla}`);
  }

  fs.writeFileSync(path.join(BACKUP_DIR, 'pre-088-schema.txt'), schemaLines.join('\n') + '\n');

  // Volcado completo de cotizaciones — es la única tabla con cambio estructural real (CHECK + DEFAULT de estado)
  const dataLines = [`# TARA-OS — Datos pre-migración 088\n# Generado: ${TIMESTAMP}\n`];

  const { data: cotizaciones, error: cError } = await supabase.from('cotizaciones').select('*');
  dataLines.push(`\n## COTIZACIONES (volcado completo — ${cotizaciones?.length ?? 'ERROR'} filas)`);
  if (cError) {
    dataLines.push(`  ERROR: ${cError.message}`);
  } else {
    (cotizaciones || []).forEach(c => dataLines.push(`  ${JSON.stringify(c)}`));
  }

  dataLines.push('\n## CONTEOS DE TABLAS ALTERADAS');
  for (const tabla of TABLAS_ALTERADAS) {
    const { count, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true });
    dataLines.push(`  ${tabla}: ${error ? `ERROR: ${error.message}` : `${count ?? 'N/A'} filas`}`);
  }

  fs.writeFileSync(path.join(BACKUP_DIR, 'pre-088-data.txt'), dataLines.join('\n') + '\n');

  console.log('\n✅ Backups generados:');
  console.log(`   ${BACKUP_DIR}/pre-088-schema.txt`);
  console.log(`   ${BACKUP_DIR}/pre-088-data.txt`);
}

main().catch(e => {
  console.error('❌ Error generando backup:', e.message);
  process.exit(1);
});
