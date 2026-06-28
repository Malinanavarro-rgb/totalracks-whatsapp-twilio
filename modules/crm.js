/**
 * TARA Matrix™ — crm.js
 * Operaciones universales de lectura y escritura sobre el CRM en Supabase.
 * No contiene lógica de negocio específica de ningún giro comercial.
 */

const { supabase } = require('./clients');

// ── CLIENTES ──────────────────────────────────────────────────────────────────

async function obtenerOCrearCliente(telefono) {
  try {
    const { data: existente } = await supabase
      .from('clientes')
      .select('*')
      .eq('telefono', telefono)
      .maybeSingle();

    if (existente) return existente;

    const { data: nuevo, error } = await supabase
      .from('clientes')
      .insert([{
        telefono,
        nombre: 'Sin nombre',
        ciudad: 'Monterrey',
        fuente: 'WhatsApp',
        estado: 'Nuevo',
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
async function guardarConversacion(clienteId, mensajeCliente, respuestaTara, categoriaPrincipal, intenciones, sentimiento) {
  try {
    await supabase.from('conversaciones').insert([{
      cliente_id:           clienteId,
      mensaje_cliente:      mensajeCliente,
      respuesta_tara:       respuestaTara,
      tipo_rack_detectado:  categoriaPrincipal,  // columna DB existente, valor ahora universal
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
 * @param {number}   clienteId
 * @param {string}   categoriaPrincipal  - categoría universal del producto/servicio
 * @param {string}   mensajeCliente
 * @param {string[]} intenciones
 */
async function crearOportunidadSiCorresponde(clienteId, categoriaPrincipal, mensajeCliente, intenciones) {
  if (!requiereCrearOportunidad(mensajeCliente, intenciones)) return;
  try {
    const { data: existentes } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('cliente_id', clienteId)
      .neq('estado', 'Perdido')
      .limit(1);

    if (!existentes || existentes.length === 0) {
      await supabase.from('oportunidades').insert([{
        cliente_id:  clienteId,
        tipo_rack:   categoriaPrincipal,  // columna DB existente, valor ahora universal
        estado:      'Calificado',
        probabilidad: 45,
        descripcion: `Cliente interesado en ${categoriaPrincipal}`,
      }]);
      console.log(`✅ Oportunidad creada: ${categoriaPrincipal}`);
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
