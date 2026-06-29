#!/usr/bin/env node
/**
 * T3.0b/T3.0c — Backup de esquema y datos pre-FASE 3
 * Ejecutar UNA VEZ antes de iniciar la implementación de FASE 3.
 *
 * Uso: node backups/generate-pre-fase3-backup.js
 *
 * Genera:
 *   backups/pre-fase3-schema.txt  — estructura de todas las tablas
 *   backups/pre-fase3-data.txt    — datos de configuración actuales
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

const TABLAS_CRM    = ['clientes', 'conversaciones', 'oportunidades', 'cotizaciones'];
const TABLAS_CONFIG = ['companies', 'personalities', 'knowledge_base', 'decision_logs'];
const TODAS_TABLAS  = [...TABLAS_CONFIG, ...TABLAS_CRM];

async function main() {
  console.log('\n📦 Generando backup pre-FASE 3...');
  console.log(`Timestamp: ${TIMESTAMP}\n`);

  // ── Schema backup ─────────────────────────────────────────────────────────
  const schemaLines = [`# TARA Matrix — Schema pre-FASE 3\n# Generado: ${TIMESTAMP}\n`];

  for (const tabla of TODAS_TABLAS) {
    try {
      // Obtener una fila para ver las columnas (introspección ligera)
      const { data, error } = await supabase.from(tabla).select('*').limit(1);
      if (error) {
        schemaLines.push(`\n## ${tabla}\n  ERROR: ${error.message}`);
        continue;
      }
      const columnas = data && data.length > 0
        ? Object.keys(data[0]).join(', ')
        : '(tabla vacía — columnas no disponibles sin filas)';
      schemaLines.push(`\n## ${tabla}\n  Columnas: ${columnas}`);
      console.log(`  ✅ ${tabla}`);
    } catch (e) {
      schemaLines.push(`\n## ${tabla}\n  ERROR: ${e.message}`);
      console.log(`  ⚠️  ${tabla}: ${e.message}`);
    }
  }

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'pre-fase3-schema.txt'),
    schemaLines.join('\n') + '\n'
  );

  // ── Datos de configuración ────────────────────────────────────────────────
  const dataLines = [`# TARA Matrix — Datos de configuración pre-FASE 3\n# Generado: ${TIMESTAMP}\n`];

  // Companies
  const { data: companies } = await supabase.from('companies').select('id, slug, nombre, estado, created_at');
  dataLines.push('\n## COMPANIES');
  (companies || []).forEach(c => {
    dataLines.push(`  [${c.slug}] id=${c.id} | nombre="${c.nombre}" | estado=${c.estado}`);
  });

  // Personalities
  const { data: personalities } = await supabase
    .from('personalities')
    .select('id, company_id, nombre_asistente, cargo, modelo, temperatura');
  dataLines.push('\n## PERSONALITIES');
  (personalities || []).forEach(p => {
    dataLines.push(`  company_id=${p.company_id} | asistente="${p.nombre_asistente}" | cargo="${p.cargo}" | modelo=${p.modelo}`);
  });

  // Knowledge base (solo categorías, no contenido completo)
  const { data: kb } = await supabase
    .from('knowledge_base')
    .select('id, company_id, categoria, created_at')
    .order('company_id');
  dataLines.push('\n## KNOWLEDGE_BASE (categorías)');
  (kb || []).forEach(k => {
    dataLines.push(`  company_id=${k.company_id} | categoria="${k.categoria}"`);
  });

  // Conteos de tablas CRM
  dataLines.push('\n## CONTEOS CRM');
  for (const tabla of TABLAS_CRM) {
    const { count, error } = await supabase
      .from(tabla)
      .select('*', { count: 'exact', head: true });
    if (!error) {
      dataLines.push(`  ${tabla}: ${count ?? 'N/A'} filas`);
    }
  }

  // Channel endpoints (si ya existe la tabla)
  const { data: endpoints, error: epError } = await supabase
    .from('channel_endpoints')
    .select('*');
  if (!epError) {
    dataLines.push('\n## CHANNEL_ENDPOINTS');
    (endpoints || []).forEach(e => {
      dataLines.push(`  company_id=${e.company_id} | endpoint="${e.endpoint}" | activo=${e.activo}`);
    });
  } else {
    dataLines.push('\n## CHANNEL_ENDPOINTS\n  (tabla no existe aún — se crea en T3.1)');
  }

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'pre-fase3-data.txt'),
    dataLines.join('\n') + '\n'
  );

  console.log('\n✅ Backups generados:');
  console.log(`   ${BACKUP_DIR}/pre-fase3-schema.txt`);
  console.log(`   ${BACKUP_DIR}/pre-fase3-data.txt`);
  console.log('\n⚡ Próximo paso: git tag fase-3-inicio && git push origin fase-3-inicio\n');
}

main().catch(e => {
  console.error('❌ Error generando backup:', e.message);
  process.exit(1);
});
