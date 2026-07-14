/**
 * TARA Matrix™ — crm.js
 * Operaciones universales de lectura y escritura sobre el CRM en Supabase.
 * No contiene lógica de negocio específica de ningún giro comercial.
 */

// RLS: parte del write path del webhook de Twilio (sin usuario final) — usa
// supabaseServicio (bypassa RLS por diseño de Supabase).
const { supabaseServicio: supabase } = require('./clients');

// ── CLIENTES ──────────────────────────────────────────────────────────────────

async function obtenerOCrearCliente(telefono, companyId) {
  try {
    const query = supabase
      .from('clientes')
      .select('*')
      .eq('telefono', telefono);

    if (companyId) query.eq('company_id', companyId);

    const { data: existente } = await query.maybeSingle();
    if (existente) return existente;

    const { data: nuevo, error } = await supabase
      .from('clientes')
      .insert([{
        telefono,
        company_id:    companyId || null,
        nombre:        'Sin nombre',
        ciudad:        'Monterrey',
        fuente:        'WhatsApp',
        estado:        'Nuevo',
        score_interes: 0,
      }])
      .select()
      .single();

    if (error) { console.error('Error creando cliente:', error); return null; }
    console.log(`✅ Cliente creado: ${telefono}`);
    return nuevo;
  } catch (e) {
    console.error('Error en obtenerOCrearCliente:', e);
    return null;
  }
}

async function actualizarScoreInteres(clienteId, scoreActual) {
  const nuevoScore = Math.min((scoreActual || 0) + 10, 100);
  await supabase
    .from('clientes')
    .update({ score_interes: nuevoScore })
    .eq('id', clienteId);
}

// ── CONVERSACIONES ────────────────────────────────────────────────────────────

async function obtenerHistorial(clienteId) {
  try {
    const { data } = await supabase
      .from('conversaciones')
      .select('mensaje_cliente, respuesta_tara')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
      .limit(10);
    return (data || []).reverse();
  } catch (e) {
    console.error('Error obteniendo historial:', e);
    return [];
  }
}

/**
 * @param {number}   clienteId
 * @param {string}   mensajeCliente
 * @param {string}   respuestaTara
 * @param {string}   categoriaPrincipal  - categoría universal del producto/servicio detectado
 * @param {string[]} intenciones
 * @param {string}   sentimiento         - extraído de OpenAI (no hardcodeado)
 */
async function guardarConversacion(clienteId, companyId, mensajeCliente, respuestaTara, categoriaPrincipal, intenciones, sentimiento) {
  try {
    await supabase.from('conversaciones').insert([{
      cliente_id:           clienteId,
      company_id:           companyId || null,
      mensaje_cliente:      mensajeCliente,
      respuesta_tara:       respuestaTara,
      tipo_rack_detectado:  categoriaPrincipal,
      intenciones:          intenciones,
      sentimiento:          sentimiento || 'Neutral',
    }]);
    console.log(`✅ Conversación guardada (cliente ${clienteId})`);
  } catch (e) {
    console.error('Error guardando conversación:', e);
  }
}

// ── OPORTUNIDADES ─────────────────────────────────────────────────────────────

const TRIGGERS_OPORTUNIDAD = [
  'cotizacion', 'cotización', 'propuesta', 'quiero cotizar',
  'me interesa', 'sí quiero', 'si quiero', 'cuánto cuesta',
  'cuanto cuesta', 'precio', 'presupuesto',
];

function requiereCrearOportunidad(mensajeCliente, intenciones) {
  const msg = mensajeCliente.toLowerCase();
  return TRIGGERS_OPORTUNIDAD.some(t => msg.includes(t)) ||
    intenciones.includes('cotizacion') ||
    intenciones.includes('precio');
}

/**
 * Fase Demo Comercial: el estado inicial de una oportunidad nueva ya NO se
 * hardcodea a 'Calificado' — cada empresa configura su propio catálogo de
 * etapas (Configuración → Proceso comercial, `pipeline_etapas`), y
 * 'Calificado' puede no existir ahí (ej. Tienda Soccer usa "Solicitud
 * nueva" como primera etapa). Una oportunidad creada con una etapa que no
 * está en el catálogo de la empresa queda invisible en el kanban y fuera
 * de cualquier KPI del dashboard que filtre por nombre de etapa — por eso
 * se usa la etapa de menor `orden` configurada, con 'Calificado' solo como
 * último recurso si la empresa no tiene ninguna etapa activa.
 */
async function _primeraEtapaPipeline(companyId) {
  if (!companyId) return 'Calificado';
  try {
    const { data } = await supabase
      .from('pipeline_etapas')
      .select('nombre')
      .eq('company_id', companyId)
      .eq('activo', true)
      .order('orden', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.nombre || 'Calificado';
  } catch (e) {
    return 'Calificado';
  }
}

/**
 * @param {number}   clienteId
 * @param {string}   categoriaPrincipal  - categoría universal del producto/servicio
 * @param {string}   mensajeCliente
 * @param {string[]} intenciones
 */
async function crearOportunidadSiCorresponde(clienteId, companyId, categoriaPrincipal, mensajeCliente, intenciones) {
  if (!requiereCrearOportunidad(mensajeCliente, intenciones)) return;
  try {
    const { data: existentes } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('cliente_id', clienteId)
      .neq('estado', 'Perdido')
      .limit(1);

    if (!existentes || existentes.length === 0) {
      const estadoInicial = await _primeraEtapaPipeline(companyId);
      await supabase.from('oportunidades').insert([{
        cliente_id:   clienteId,
        company_id:   companyId || null,
        tipo_rack:    categoriaPrincipal,
        estado:       estadoInicial,
        probabilidad: 45,
        descripcion:  `Cliente interesado en ${categoriaPrincipal}`,
      }]);
      console.log(`✅ Oportunidad creada: ${categoriaPrincipal} (etapa: ${estadoInicial})`);
    }
  } catch (e) {
    console.error('Error creando oportunidad:', e);
  }
}

module.exports = {
  obtenerOCrearCliente,
  actualizarScoreInteres,
  obtenerHistorial,
  guardarConversacion,
  crearOportunidadSiCorresponde,
};
