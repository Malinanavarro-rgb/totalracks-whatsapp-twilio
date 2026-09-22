/**
 * TARA Matrix™ — crear-bucket-documentos-cliente
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea (si no existe) el bucket privado de Supabase Storage para documentos
 * del cliente subidos manualmente desde el expediente — mismo criterio que
 * crear-bucket-documentos-proveedor.js/crear-bucket-adjuntos.js: privado,
 * servido solo por URL firmada.
 *
 * Uso: node scripts/crear-bucket-documentos-cliente.js
 *
 * @module scripts/crear-bucket-documentos-cliente
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { BUCKET } = require('../modules/documentos-cliente');

(async () => {
  const { data: existentes, error: errListar } = await supabase.storage.listBuckets();
  if (errListar) throw new Error(errListar.message);

  if (existentes.some(b => b.name === BUCKET)) {
    console.log(`✅ El bucket "${BUCKET}" ya existe — nada que hacer.`);
    process.exit(0);
  }

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20MB
  });
  if (error) throw new Error(error.message);

  console.log(`✅ Bucket "${BUCKET}" creado (privado, límite 20MB por archivo).`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error creando el bucket de documentos-cliente:', err.message);
  process.exit(1);
});
