/**
 * TARA Matrix™ — crear-bucket-documentos-proveedor
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea (si no existe) el bucket privado de Supabase Storage donde se guardan
 * los documentos de proveedor (fichas técnicas, PDF/imagen) subidos desde el
 * panel — Centro de Conocimiento / Especialista Solar, Fase 6. Mismo
 * criterio que crear-bucket-cotizaciones-pdf.js/crear-bucket-adjuntos.js:
 * privado, servido solo por URL firmada.
 *
 * Uso: node scripts/crear-bucket-documentos-proveedor.js
 *
 * @module scripts/crear-bucket-documentos-proveedor
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { BUCKET } = require('../modules/documentos-proveedor');

(async () => {
  const { data: existentes, error: errListar } = await supabase.storage.listBuckets();
  if (errListar) throw new Error(errListar.message);

  if (existentes.some(b => b.name === BUCKET)) {
    console.log(`✅ El bucket "${BUCKET}" ya existe — nada que hacer.`);
    process.exit(0);
  }

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20MB — ficha técnica en PDF/imagen no debería acercarse a esto
  });
  if (error) throw new Error(error.message);

  console.log(`✅ Bucket "${BUCKET}" creado (privado, límite 20MB por archivo).`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error creando el bucket de documentos-proveedor:', err.message);
  process.exit(1);
});
