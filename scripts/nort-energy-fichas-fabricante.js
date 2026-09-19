#!/usr/bin/env node
/**
 * Nort Energy — fichas técnicas oficiales de fabricante → borradores para
 * confirmar (2026-09-19).
 *
 * Por cada producto del manifiesto: descarga el PDF de su ficha, la extrae con
 * modules/documentos-proveedor.js CON el modelo exacto del catálogo como
 * objetivo (claves canónicas del motor + columna del modelo correcto + chequeo
 * de potencia y de coherencia física), y SOLO si la extracción confirma que
 * leyó el modelo correcto guarda el documento en `documentos_proveedor`, enlazado
 * al producto, con `nombre_archivo` = la URL de origen.
 *
 * NUNCA confirma ni toca `productos`: el borrador queda pendiente hasta que una
 * persona lo revise y confirme en Configuración → Documentos de proveedor
 * (ver el flujo anti-alucinación de la Fase 6).
 *
 * Idempotente: si el producto ya tiene un documento con esa misma URL, lo salta.
 *
 * Uso:
 *   node scripts/nort-energy-fichas-fabricante.js            # procesa el manifiesto
 *   node scripts/nort-energy-fichas-fabricante.js --dry      # solo extrae y reporta, no guarda nada
 */

require('dotenv').config();
const OpenAI = require('openai');
const { supabaseServicio: supabase } = require('../modules/clients');
const { extraerFichaTecnica, subirDocumento, procesarDocumento } = require('../modules/documentos-proveedor');

const DRY = process.argv.includes('--dry');

const LUXEN = 'https://luxensolar.com/wp-content/uploads';

/**
 * `modelo` = el del catálogo (productos.modelo). `urls` = candidatas en orden de
 * preferencia: se prueban hasta que una confirme el modelo correcto. Productos
 * sin URL verificable quedan listados en `pendientes` — nunca se adivina una.
 */
const MANIFIESTO = [
  { modelo: 'LR7-72HTH-615M', proveedor: 'LONGi', urls: ['https://static.longi.com/LR_7_72_HTH_605_615_M_30_30_and_15_Frame_Explorer_20240511_V2_d0c9b7df55.pdf'] },
  { modelo: 'LR5-54HTB-435M', proveedor: 'LONGi', urls: ['https://www.mg-solar-shop.com/media/pdf/16/ae/c4/datasheet_longi_hi-mo6_explorer_415-435m_lr5-54htb.pdf'] },
  { modelo: 'LNDT-620ND', proveedor: 'LUXEN', urls: [`${LUXEN}/2024/11/LUXEN-G12R-132-LNDT-605-625N-DG-2382-1134-30.pdf`] },
  { modelo: 'LNVU-580ND', proveedor: 'LUXEN', urls: [`${LUXEN}/2024/11/LUXEN-M10-144-LNVU-570-590N-DG-2278-1134-30.pdf`] },
  { modelo: 'LNVU-540M', proveedor: 'LUXEN', urls: [`${LUXEN}/2024/01/LUXEN-SERIES-5-182-MONOFACIAL-144cells-535-555w-MONO.pdf`] },
  { modelo: 'SRP-550-BMA-HV', proveedor: 'Seraphim', urls: [
    'https://www.seraphim-energy.com/uploads/upload/files/20250311/a16fef31ff18b24c43c916052324ccf4.pdf',
    'https://jouleenergysolutions.co.za/wp-content/uploads/2023/12/JES-Spec-Sheets_Seraphim-Solar-Module-SIV-Series-450W460W550W-Consolidated-2.pdf',
  ] },
  { modelo: 'SRP-610-BTC-BG', proveedor: 'Seraphim', urls: ['https://www.seraphim-energy.com/uploads/upload/files/20241121/3db61ea62fb53ca8c222697d985d072b.pdf'] },
];

async function descargarPdf(url) {
  const respuesta = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (TARA Matrix ficha-tecnica)' } });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const buffer = Buffer.from(await respuesta.arrayBuffer());
  if (buffer.subarray(0, 4).toString() !== '%PDF') throw new Error('la respuesta no es un PDF');
  return buffer;
}

async function main() {
  const openai = new (OpenAI.OpenAI || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });
  const { data: empresa } = await supabase.from('companies').select('id').ilike('nombre', '%Nort Energy%').maybeSingle();
  if (!empresa) throw new Error('No se encontró Nort Energy');
  const companyId = empresa.id;

  const { data: catalogo } = await supabase.from('productos').select('id, marca, modelo, tipo, specs')
    .eq('company_id', companyId).eq('activo', true).in('tipo', ['panel_solar', 'inversor']);

  const resumen = [];
  console.log(DRY ? '— MODO --dry: no se guarda nada —\n' : '');

  for (const item of MANIFIESTO) {
    const producto = catalogo.find((p) => p.modelo === item.modelo);
    if (!producto) { resumen.push([item.modelo, 'NO ESTÁ EN EL CATÁLOGO']); continue; }

    const { data: yaExiste } = await supabase.from('documentos_proveedor').select('id')
      .eq('company_id', companyId).eq('producto_id', producto.id).in('nombre_archivo', item.urls).limit(1);
    if (yaExiste?.length) { resumen.push([item.modelo, `ya tiene borrador (doc #${yaExiste[0].id}) — se salta`]); continue; }

    const objetivo = { marca: producto.marca, modelo: producto.modelo, tipo: producto.tipo, potencia_wp: producto.specs?.potencia_wp };
    let resultadoFinal = null;

    for (const url of item.urls) {
      try {
        const buffer = await descargarPdf(url);
        const extraccion = await extraerFichaTecnica(openai, { buffer, mimeType: 'application/pdf', objetivo });
        if (!extraccion.es_ficha_tecnica || !extraccion.modelo_coincide) {
          console.log(`  ✗ ${item.modelo} @ ${url.split('/').pop()}: ${extraccion.advertencias?.[0] || extraccion._motivo || 'no es la ficha de este modelo'}`);
          continue;
        }

        if (DRY) {
          resultadoFinal = { estado: `OK (dry) — faltan: [${extraccion.campos_faltantes}] — advertencias: ${extraccion.advertencias.length}`, extraccion };
          break;
        }
        const doc = await subirDocumento(supabase, {
          company_id: companyId, proveedor: item.proveedor, tipo_documento: 'ficha_tecnica',
          buffer, mimeType: 'application/pdf', nombre_archivo: url, producto_id: producto.id,
        });
        const procesado = await procesarDocumento(openai, supabase, companyId, doc.id);
        const d = procesado.datos_extraidos;
        resultadoFinal = { estado: `borrador guardado (doc #${doc.id}) — faltan: [${d.campos_faltantes}] — advertencias: ${d.advertencias.length}`, extraccion: d };
        break;
      } catch (e) {
        console.log(`  ✗ ${item.modelo} @ ${url.split('/').pop()}: ${e.message}`);
      }
    }

    resumen.push([item.modelo, resultadoFinal?.estado || 'SIN FICHA VÁLIDA — ninguna URL candidata confirmó el modelo']);
    if (resultadoFinal?.extraccion.advertencias?.length) resultadoFinal.extraccion.advertencias.forEach((a) => console.log(`    ⚠ ${item.modelo}: ${a}`));
  }

  console.log('\n=== Resumen ===');
  resumen.forEach(([modelo, estado]) => console.log(`${modelo}: ${estado}`));
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
