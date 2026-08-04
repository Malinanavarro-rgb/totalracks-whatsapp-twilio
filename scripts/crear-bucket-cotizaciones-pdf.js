/**
 * TARA Matrix™ — crear-bucket-cotizaciones-pdf
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea (si no existe) el bucket privado de Supabase Storage donde se guardan
 * los PDFs generados de cotizaciones (Fase 3, Ingeniería y Cotización).
 * Mismo criterio que scripts/crear-bucket-adjuntos.js: privado, servido solo
 * por URL firmada (ver modules/envio-documentos.js), nunca público directo.
 *
 * Uso: node scripts/crear-bucket-cotizaciones-pdf.js
 *
 * @module scripts/crear-bucket-cotizaciones-pdf
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { BUCKET_COTIZACIONES_PDF } = require('../modules/cotizacion-pdf');

(async () => {
  const { data: existentes, error: errListar } = await supabase.storage.listBuckets();
  if (errListar) throw new Error(errListar.message);

  if (existentes.some(b => b.name === BUCKET_COTIZACIONES_PDF)) {
    console.log(`✅ El bucket "${BUCKET_COTIZACIONES_PDF}" ya existe — nada que hacer.`);
    process.exit(0);
  }

  const { error } = await supabase.storage.createBucket(BUCKET_COTIZACIONES_PDF, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024, // 10MB — un PDF de cotización no debería acercarse a esto
  });
  if (error) throw new Error(error.message);

  console.log(`✅ Bucket "${BUCKET_COTIZACIONES_PDF}" creado (privado, límite 10MB por archivo).`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error creando el bucket de cotizaciones-pdf:', err.message);
  process.exit(1);
});
