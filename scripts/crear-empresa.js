/**
 * TARA Matrix™ — crear-empresa
 * ─────────────────────────────────────────────────────────────────────────────
 * Da de alta una empresa nueva y la configura automáticamente según su
 * industria (motor de plantillas — ver modules/plantillas-industria.js,
 * migración 044). Sin portal de onboarding con UI todavía — este script es
 * el punto de entrada mientras tanto, mismo criterio que
 * scripts/conectar-empresa-meta.js.
 *
 * No conecta ningún canal de WhatsApp — eso se hace por separado
 * (scripts/conectar-empresa-meta.js o Twilio) una vez que la empresa ya
 * existe.
 *
 * Uso:
 *   node scripts/crear-empresa.js \
 *     --nombre "Tienda Soccer" \
 *     --descripcion "Fabricante y tienda de uniformes deportivos personalizados para fútbol, basquetbol, béisbol, voleibol, handball y ciclismo. Monterrey, NL." \
 *     [--slug tienda-soccer] \
 *     [--usuario-email alina.navarro@mypallets.com.mx]
 *
 * @module scripts/crear-empresa
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { crearEmpresaConIndustria } = require('../modules/plantillas-industria');

function leerArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const clave = process.argv[i]?.replace(/^--/, '');
    args[clave] = process.argv[i + 1];
  }
  return args;
}

function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function vincularUsuario(companyId, email) {
  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, nombre')
    .eq('email', email)
    .maybeSingle();

  if (error || !usuario) {
    console.warn(`⚠️  No se encontró ningún usuario con email ${email} — la empresa se creó, pero nadie quedó vinculado. Vincúlalo manualmente en usuarios_empresas.`);
    return;
  }

  const { error: errVinculo } = await supabase
    .from('usuarios_empresas')
    .insert([{ usuario_id: usuario.id, company_id: companyId, rol: 'owner', activo: true }]);

  if (errVinculo) {
    console.warn(`⚠️  No se pudo vincular a ${email} como owner: ${errVinculo.message}`);
    return;
  }

  console.log(`✅ ${usuario.nombre || email} vinculado como owner — ya puede ver esta empresa desde el selector de empresa activa.`);
}

(async () => {
  const args = leerArgs();

  const nombre = args['nombre'];
  const descripcion = args['descripcion'];
  const slug = args['slug'] || generarSlug(nombre || '');
  const usuarioEmail = args['usuario-email'];

  if (!nombre || !descripcion) {
    console.error('❌ Uso: node scripts/crear-empresa.js --nombre "Nombre" --descripcion "Descripción del negocio" [--slug slug-propio] [--usuario-email correo@empresa.com]');
    process.exit(1);
  }

  const { company, industriaDetectada, huboCoincidencia } = await crearEmpresaConIndustria(supabase, {
    nombre, descripcionNegocio: descripcion, slug,
  });

  console.log(`✅ Empresa creada: ${company.nombre} (${company.id})`);

  if (huboCoincidencia) {
    console.log(`✅ TARA detectó el giro: ${industriaDetectada} — workflow, pipeline, servicios y base de conocimiento ya configurados.`);
  } else {
    console.warn('⚠️  TARA no reconoció el giro de este negocio a partir de la descripción — la empresa se creó sin workflow/pipeline/KB iniciales. Configúralos manualmente desde el panel (Configuración → Workflows/Pipeline/Knowledge Base).');
  }

  if (usuarioEmail) {
    await vincularUsuario(company.id, usuarioEmail);
  }

  process.exit(0);
})().catch(err => {
  console.error('❌ Error creando la empresa:', err.message);
  process.exit(1);
});
