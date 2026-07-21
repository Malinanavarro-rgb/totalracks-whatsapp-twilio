/**
 * TARA Matrix™ — crear-bucket-adjuntos
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea (si no existe) el bucket privado de Supabase Storage donde se guardan
 * los adjuntos reales del Inbox Inteligente (v0.4) — fotos, audios, videos y
 * documentos que los clientes envían por WhatsApp. Privado: los archivos de
 * un cliente solo deben ser accesibles vía la ruta autenticada del backend
 * (GET /api/inbox/mensajes/:id/adjunto), nunca por URL pública directa.
 *
 * A diferencia de las migraciones SQL (que Alina pega a mano en el SQL
 * Editor de Supabase), crear un bucket es una llamada al API de Storage —
 * se puede ejecutar programáticamente con la service_role key. Se corre una
 * sola vez por proyecto de Supabase.
 *
 * Uso:
 *   node scripts/crear-bucket-adjuntos.js
 *
 * @module scripts/crear-bucket-adjuntos
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { BUCKET } = require('../modules/inbox-adjuntos');

(async () => {
  const { data: existentes, error: errListar } = await supabase.storage.listBuckets();
  if (errListar) throw new Error(errListar.message);

  if (existentes.some(b => b.name === BUCKET)) {
    console.log(`✅ El bucket "${BUCKET}" ya existe — nada que hacer.`);
    process.exit(0);
  }

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024, // 25MB — suficiente para fotos/audios/videos cortos de WhatsApp
  });
  if (error) throw new Error(error.message);

  console.log(`✅ Bucket "${BUCKET}" creado (privado, límite 25MB por archivo).`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error creando el bucket de adjuntos:', err.message);
  process.exit(1);
});
