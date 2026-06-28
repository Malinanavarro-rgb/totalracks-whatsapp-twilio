/**
 * ============================================================
 * TARA Matrix™ — Arquitectura Multi-Empresa
 * Twilio + Supabase + OpenAI | Total Racks v3
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

// ============================================================
// CLIENTES EXTERNOS
// ============================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { 'Accept-Encoding': 'identity' },
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Empresa activa para esta instancia
const COMPANY_SLUG = process.env.COMPANY_SLUG || 'totalracks';

// ============================================================
// CORE — PARSE SEGURO DE JSON
// ============================================================

function safeParseJSON(contenido) {
  try {
    return { ok: true, data: JSON.parse(contenido) };
  } catch (_) {}

  try {
    const inicio = contenido.indexOf('{');
    const fin = contenido.lastIndexOf('}');
    if (inicio !== -1 && fin > inicio) {
      return { ok: true, data: JSON.parse(contenido.substring(inicio, fin + 1)) };
    }
  } catch (_) {}

  const texto = contenido.trim();
  return {
    ok: false,
    data: {
      tipo_rack: 'Sin clasificar',
      intenciones: ['consulta'],
      sentimiento: 'Neutral',
      respuesta_tara: texto.length > 10 && texto.length < 600
        ? texto
        : '¿En qué puedo ayudarte con tu proyecto de almacenamiento?',
    },
  };
}

// ============================================================
// COMPANIES — CONFIGURACIÓN DE EMPRESA (CON CACHE)
// ============================================================

let _configCache = null;
let _configCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function obtenerConfigEmpresa() {
  if (_configCache && (Date.now() - _configCacheTime) < CACHE_TTL) {
    return _configCache;
  }

  const { data: company, error: errCompany } = await supabase
    .from('companies')
    .select('*')
    .eq('slug', COMPANY_SLUG)
    .eq('estado', 'activo')
    .maybeSingle();

  if (errCompany || !company) {
    throw new Error(`Empresa no encontrada o inactiva: ${COMPANY_SLUG}`);
  }

  const { data: personality } = await supabase
    .from('personalities')
    .select('*')
    .eq('company_id', company.id)
    .maybeSingle();

  const { data: knowledge } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('company_id', company.id)
    .order('categoria');

  _configCache = { company, personality, knowledge: knowledge || [] };
  _configCacheTime = Date.now();

  console.log(`✅ Config cargada: ${company.nombre} | ${personality?.nombre_asistente}`);
  return _configCache;
}

// ============================================================
// PROMPTS — CONSTRUIR SYSTEM PROMPT DINÁMICO
// ============================================================

async function construirSystemPrompt() {
  const { company, personality, knowledge } = await obtenerConfigEmpresa();

  const nombre = personality?.nombre_asistente || company.nombre;
  const cargo = personality?.cargo || 'Asistente Virtual';
  const tono = personality?.tono || 'profesional y amable';
  const objetivo = personality?.objetivo || 'Ayudar al cliente.';

  const secciones = knowledge
    .map(k => `[${k.categoria.toUpperCase()}]\n${k.contenido}`)
    .join('\n\n');

  return `Eres ${nombre}, ${cargo} de ${company.nombre}.
${company.descripcion ? company.descripcion + '.' : ''}

IDENTIDAD:
Eres una especialista real. Hablas con experiencia, seguridad y proximidad. Tono: ${tono}.
Nunca dices que eres una IA, un bot o una inteligencia artificial.
Nunca usas: "Gracias por tu mensaje", "Estoy aquí para ayudarte", "¿Puedes proporcionar más información?", "Depende" sin explicar.

OBJETIVO:
${objetivo}

CONOCIMIENTO:
${secciones}

REGLAS DE CONVERSACIÓN:
- Primero entender, después recomendar, finalmente cotizar. No vendas antes de entender el proyecto.
- Máximo DOS preguntas por respuesta.
- Nunca repitas preguntas ya respondidas en el historial.
- Cuando tengas suficiente información, da la recomendación con justificación técnica concreta.
- Si ya tienes los datos, no sigas pidiendo más. Recomienda.
- Nunca inventes precios. Di que con los datos del proyecto preparas una propuesta formal.
- Si piden cotización: confirma los datos faltantes de forma natural, no en lista.
- Si el cliente dice "ya te di los datos" o "¿qué más necesitas?", lista solo lo que falta.
- Máximo 130 palabras por respuesta. Concisa y directa.
- Responde siempre en español.

RESPUESTA: SOLO JSON válido. Sin texto antes ni después. Sin markdown. Sin backticks.
{
  "tipo_rack": "Selectivo|Cantilever|Drive In|Drive Through|Flow Rack|Entrepiso|Sin clasificar",
  "intenciones": ["consulta", "precio", "cotizacion", "recomendacion"],
  "sentimiento": "Positivo|Neutral|Negativo|Muy interesado",
  "respuesta_tara": "tu respuesta aquí, máximo 130 palabras"
}`;
}

// ============================================================
// CRM — CLIENTES
// ============================================================

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

// ============================================================
// CRM — HISTORIAL (últimos 10 mensajes)
// ============================================================

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

// ============================================================
// CRM — GUARDAR CONVERSACIÓN
// ============================================================

async function guardarConversacion(clienteId, mensajeCliente, respuestaTara, tipoRack, intenciones) {
  try {
    await supabase.from('conversaciones').insert([{
      cliente_id: clienteId,
      mensaje_cliente: mensajeCliente,
      respuesta_tara: respuestaTara,
      tipo_rack_detectado: tipoRack,
      intenciones: intenciones,
      sentimiento: 'Neutral',
    }]);
    console.log(`✅ Conversación guardada (cliente ${clienteId})`);
  } catch (e) {
    console.error('Error guardando conversación:', e);
  }
}

// ============================================================
// CRM — OPORTUNIDADES
// ============================================================

const TRIGGERS_COTIZACION = [
  'cotizacion', 'cotización', 'propuesta', 'quiero cotizar',
  'me interesa', 'sí quiero', 'si quiero', 'cuánto cuesta',
  'cuanto cuesta', 'precio', 'presupuesto',
];

function debeCrearOportunidad(mensajeCliente, intenciones) {
  const msg = mensajeCliente.toLowerCase();
  return TRIGGERS_COTIZACION.some(t => msg.includes(t)) ||
    intenciones.includes('cotizacion') ||
    intenciones.includes('precio');
}

async function crearOportunidadSiCorresponde(clienteId, tipoRack, mensajeCliente, intenciones) {
  if (!debeCrearOportunidad(mensajeCliente, intenciones)) return;
  try {
    const { data: existentes } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('cliente_id', clienteId)
      .neq('estado', 'Perdido')
      .limit(1);

    if (!existentes || existentes.length === 0) {
      await supabase.from('oportunidades').insert([{
        cliente_id: clienteId,
        tipo_rack: tipoRack,
        estado: 'Calificado',
        probabilidad: 45,
        descripcion: `Cliente interesado en ${tipoRack}`,
      }]);
      console.log(`✅ Oportunidad creada: ${tipoRack}`);
    }
  } catch (e) {
    console.error('Error creando oportunidad:', e);
  }
}

// ============================================================
// KNOWLEDGE — LLAMADA A OPENAI
// ============================================================

async function analizarConOpenAI(mensajeCliente, historial) {
  try {
    const systemPrompt = await construirSystemPrompt();

    const mensajes = [{ role: 'system', content: systemPrompt }];

    for (const h of historial) {
      mensajes.push({ role: 'user', content: h.mensaje_cliente });
      mensajes.push({ role: 'assistant', content: h.respuesta_tara });
    }
    mensajes.push({ role: 'user', content: mensajeCliente });

    console.log(`📤 OpenAI: historial=${historial.length} msgs`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajes,
      temperature: 0.6,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });

    const crudo = response.choices[0].message.content.trim();
    console.log(`📥 OpenAI raw: ${crudo.substring(0, 150)}`);

    const resultado = safeParseJSON(crudo);
    if (!resultado.ok) console.log('⚠️ Fallback JSON activado');
    else console.log(`✅ JSON: tipo_rack=${resultado.data.tipo_rack}`);

    return resultado.data;
  } catch (e) {
    console.error('❌ Error OpenAI:', e.message);
    return {
      tipo_rack: 'Sin clasificar',
      intenciones: ['consulta'],
      sentimiento: 'Neutral',
      respuesta_tara: '¿En qué puedo ayudarte con tu proyecto de almacenamiento?',
    };
  }
}

// ============================================================
// SERVICES — PROCESAR MENSAJE PRINCIPAL
// ============================================================

async function procesarMensajeTwilio(telefono, mensajeCliente) {
  try {
    console.log(`\n📱 [${COMPANY_SLUG}] ${telefono}: "${mensajeCliente}"`);

    const cliente = await obtenerOCrearCliente(telefono);
    if (!cliente) return '¿En qué puedo ayudarte?';

    const historial = await obtenerHistorial(cliente.id);
    const analisis = await analizarConOpenAI(mensajeCliente, historial);

    await guardarConversacion(
      cliente.id, mensajeCliente, analisis.respuesta_tara,
      analisis.tipo_rack, analisis.intenciones
    );

    await crearOportunidadSiCorresponde(
      cliente.id, analisis.tipo_rack, mensajeCliente, analisis.intenciones
    );

    const nuevoScore = Math.min((cliente.score_interes || 0) + 10, 100);
    await supabase.from('clientes').update({ score_interes: nuevoScore }).eq('id', cliente.id);

    console.log(`✅ Respuesta: ${analisis.respuesta_tara.substring(0, 80)}...`);
    return analisis.respuesta_tara;
  } catch (e) {
    console.error('❌ Error general:', e);
    return 'Tuve un problema técnico. Por favor intenta de nuevo.';
  }
}

// ============================================================
// RUTAS
// ============================================================

app.post('/webhook/twilio', async (req, res) => {
  try {
    const telefono = req.body.From.replace('whatsapp:', '');
    const mensajeCliente = req.body.Body;
    const respuesta = await procesarMensajeTwilio(telefono, mensajeCliente);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuesta);
    res.type('text/xml').send(twiml.toString());
  } catch (e) {
    console.error('Error webhook:', e);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Error técnico. Intenta de nuevo.');
    res.type('text/xml').send(twiml.toString());
  }
});

app.get('/health', async (req, res) => {
  try {
    const { company } = await obtenerConfigEmpresa();
    res.json({
      status: 'OK',
      empresa: company.nombre,
      slug: COMPANY_SLUG,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'ERROR', error: e.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const { count: clientesCount } = await supabase
      .from('clientes').select('*', { count: 'exact', head: true });

    const { data: oportunidades } = await supabase
      .from('oportunidades')
      .select('presupuesto_estimado, probabilidad')
      .neq('estado', 'Ganado').neq('estado', 'Perdido');

    const pipeline = (oportunidades || []).reduce(
      (s, o) => s + ((o.presupuesto_estimado || 0) * ((o.probabilidad || 30) / 100)), 0
    );

    res.json({
      empresa: COMPANY_SLUG,
      clientesTotales: clientesCount || 0,
      oportunidadesAbiertas: oportunidades?.length || 0,
      pipelineEstimado: Math.round(pipeline),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({
  sistema: 'TARA Matrix™',
  empresa: COMPANY_SLUG,
  webhook: 'POST /webhook/twilio',
  health: 'GET /health',
  dashboard: 'GET /api/dashboard',
}));

// ============================================================
// INICIO
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('\n============================================================');
  console.log('🚀 TARA Matrix™ INICIADA');
  console.log('============================================================');
  console.log(`Puerto:  ${PORT}`);
  console.log(`Empresa: ${COMPANY_SLUG}`);
  console.log('Webhook: /webhook/twilio');
  console.log('============================================================\n');

  try {
    await obtenerConfigEmpresa();
  } catch (e) {
    console.error('⚠️ No se pudo cargar config de empresa:', e.message);
  }
});

module.exports = app;
