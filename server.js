require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

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

// ============================================================
// PARSE SEGURO DE JSON
// ============================================================

function safeParseJSON(contenido) {
  // Intento 1: parseo directo
  try {
    return { ok: true, data: JSON.parse(contenido) };
  } catch (_) {}

  // Intento 2: extraer primer bloque { ... }
  try {
    const inicio = contenido.indexOf('{');
    const fin = contenido.lastIndexOf('}');
    if (inicio !== -1 && fin !== -1 && fin > inicio) {
      const bloque = contenido.substring(inicio, fin + 1);
      return { ok: true, data: JSON.parse(bloque) };
    }
  } catch (_) {}

  // Fallback: usar el texto como respuesta_tara si es legible
  const textoLimpio = contenido.trim();
  const esMensajeValido = textoLimpio.length > 10 && textoLimpio.length < 500;
  return {
    ok: false,
    data: {
      tipo_rack: 'Sin clasificar',
      intenciones: ['consulta'],
      sentimiento: 'Neutral',
      respuesta_tara: esMensajeValido
        ? textoLimpio
        : '¡Hola! Soy TARA™ de Total Racks. ¿En qué puedo ayudarte con tu proyecto de almacenamiento?',
    },
  };
}

// ============================================================
// SUPABASE - CLIENTES
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
      .insert([{ telefono, nombre: 'Sin nombre', ciudad: 'Monterrey', fuente: 'WhatsApp', estado: 'Nuevo', score_interes: 0 }])
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
// SUPABASE - HISTORIAL
// ============================================================

async function obtenerHistorial(clienteId, limite = 10) {
  try {
    const { data } = await supabase
      .from('conversaciones')
      .select('mensaje_cliente, respuesta_tara')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
      .limit(limite);
    return (data || []).reverse();
  } catch (e) {
    console.error('Error obteniendo historial:', e);
    return [];
  }
}

// ============================================================
// SUPABASE - GUARDAR CONVERSACIÓN
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
// SUPABASE - OPORTUNIDAD
// ============================================================

const PALABRAS_COTIZACION = ['cotizacion', 'cotización', 'propuesta', 'quiero cotizar', 'me interesa', 'sí quiero', 'si quiero', 'cuánto cuesta', 'cuanto cuesta', 'precio'];

function clientePideProyecto(mensajeCliente, intenciones) {
  const msg = mensajeCliente.toLowerCase();
  const pideCotizacion = PALABRAS_COTIZACION.some(p => msg.includes(p));
  const intencionCotizacion = intenciones.includes('cotizacion') || intenciones.includes('precio');
  return pideCotizacion || intencionCotizacion;
}

async function crearOportunidadSiCorresponde(clienteId, tipoRack, mensajeCliente, intenciones) {
  if (!clientePideProyecto(mensajeCliente, intenciones)) return;
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
// OPENAI
// ============================================================

const SYSTEM_PROMPT = `Eres TARA™, Especialista en Soluciones de Almacenamiento de Total Racks, empresa de racks industriales en Monterrey, NL, México.

IDENTIDAD:
Eres una ingeniera comercial con experiencia en diseño de sistemas de almacenaje. Hablas como una persona real: directa, cercana, profesional y segura. Nunca dices que eres una IA, un bot o una inteligencia artificial. Nunca usas frases genéricas como "Gracias por tu mensaje", "Estoy aquí para ayudarte", "¿Puedes proporcionar más información?" o "Depende".

FILOSOFÍA: Primero entender, después recomendar, finalmente cotizar. No vendas antes de entender el proyecto.

CONOCIMIENTO TÉCNICO:
- Rack Selectivo: el más versátil. Para tarimas con variedad de productos (SKUs mixtos) y alta rotación. Acceso directo a cada posición. La solución más común en bodegas medianas y grandes.
- Drive-In / Drive-Through: máxima densidad. Para producto homogéneo de baja rotación (LIFO) o alta (FIFO). Reduce pasillos al mínimo.
- Cantilever: para tubos, perfiles metálicos, madera, rollos o cualquier material largo sin embalaje. Sin columnas frontales que obstruyan la carga.
- Flow Rack: alta rotación estricta FIFO. Para líneas de producción, perecederos o distribución intensiva.
- Entrepiso Industrial: aprovecha la altura de la nave creando un segundo nivel. Para picking manual, oficinas o archivo.
- Lockers Industriales: para herramientas, equipo personal o valuables.

VENTAJA EXCLUSIVA TOTAL RACKS: Único proveedor en el noreste con sistema digital propio para visualizar inventario en tiempo real. Sin costo adicional de software. Siempre mencionarlo antes de cerrar.

DATOS QUE NECESITAS PARA RECOMENDAR (recópilalos de forma natural, uno o dos por mensaje):
1. Qué almacenan (tipo de producto o mercancía)
2. Peso aproximado por tarima o carga
3. Medidas del producto o tarima
4. Altura libre de la nave o almacén
5. Dimensiones del espacio (largo x ancho)
6. Cantidad de posiciones estimadas
7. Tipo de operación: alta/baja rotación, FIFO o LIFO

REGLAS DE CONVERSACIÓN:
- Máximo DOS preguntas por respuesta. No hagas listas enormes de preguntas.
- Si el cliente ya dio un dato, NO vuelvas a preguntarlo. El historial de conversación te lo dice.
- Cuando tengas suficiente información, da la recomendación con justificación técnica concreta. No sigas pidiendo más datos innecesariamente.
- Nunca inventes precios. Si preguntan, di que los precios dependen de la configuración y que con los datos del proyecto puedes preparar una propuesta formal.
- Si el cliente pide cotización, confirma los datos faltantes de forma natural: "Perfecto, con lo que hemos revisado ya tengo una idea clara. Solo me falta confirmar el peso por tarima y la altura libre de la nave para preparar una propuesta."
- Si el cliente dice "ya te di los datos" o "qué más necesitas", lista solo lo que falta.
- Cuando ya tengas todo, responde como especialista: "Con lo que me compartes, una solución de rack selectivo sería ideal porque..."
- Máximo 130 palabras por respuesta. Sé concisa y clara.
- Responde siempre en español.

DATOS DE CONTACTO (pedir cuando el cliente quiera cotización):
- Nombre completo
- Empresa
- Correo electrónico
- Teléfono de contacto
- Ciudad

RESPUESTA: SOLO JSON válido. Sin texto antes ni después. Sin markdown. Sin backticks.
{
  "tipo_rack": "Selectivo|Cantilever|Drive In|Drive Through|Flow Rack|Entrepiso|Sin clasificar",
  "intenciones": ["consulta", "precio", "cotizacion", "recomendacion"],
  "sentimiento": "Positivo|Neutral|Negativo|Muy interesado",
  "respuesta_tara": "tu respuesta aquí como especialista, máximo 130 palabras, sin frases genéricas"
}`;

async function analizarConOpenAI(mensajeCliente, historial) {
  try {
    const mensajes = [{ role: 'system', content: SYSTEM_PROMPT }];

    for (const h of historial) {
      mensajes.push({ role: 'user', content: h.mensaje_cliente });
      mensajes.push({ role: 'assistant', content: h.respuesta_tara });
    }
    mensajes.push({ role: 'user', content: mensajeCliente });

    console.log(`📤 Enviando a OpenAI: historial=${historial.length} mensajes + mensaje actual`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajes,
      temperature: 0.6,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });

    const crudo = response.choices[0].message.content.trim();
    console.log(`📥 Respuesta cruda OpenAI: ${crudo.substring(0, 200)}`);

    const resultado = safeParseJSON(crudo);
    if (!resultado.ok) {
      console.log('⚠️ Fallback activado — OpenAI no respondió JSON válido');
    } else {
      console.log(`✅ JSON parseado: tipo_rack=${resultado.data.tipo_rack}`);
    }

    return resultado.data;
  } catch (error) {
    console.error('❌ Error en OpenAI:', error.message);
    return {
      tipo_rack: 'Sin clasificar',
      intenciones: ['consulta'],
      sentimiento: 'Neutral',
      respuesta_tara: '¡Hola! Soy TARA™ de Total Racks. ¿En qué puedo ayudarte con tu proyecto de almacenamiento?',
    };
  }
}

// ============================================================
// PROCESAR MENSAJE PRINCIPAL
// ============================================================

async function procesarMensajeTwilio(telefono, mensajeCliente) {
  try {
    console.log(`\n📱 Mensaje de ${telefono}: "${mensajeCliente}"`);

    const cliente = await obtenerOCrearCliente(telefono);
    if (!cliente) return 'Disculpa, tuve un problema. Intenta de nuevo.';

    const historial = await obtenerHistorial(cliente.id, 10);
    const analisis = await analizarConOpenAI(mensajeCliente, historial);

    await guardarConversacion(cliente.id, mensajeCliente, analisis.respuesta_tara, analisis.tipo_rack, analisis.intenciones);
    await crearOportunidadSiCorresponde(cliente.id, analisis.tipo_rack, mensajeCliente, analisis.intenciones);

    const nuevoScore = Math.min((cliente.score_interes || 0) + 10, 100);
    await supabase.from('clientes').update({ score_interes: nuevoScore }).eq('id', cliente.id);

    console.log(`✅ Respuesta: ${analisis.respuesta_tara.substring(0, 100)}`);
    return analisis.respuesta_tara;
  } catch (error) {
    console.error('❌ Error general:', error);
    return 'Disculpa, tuve un problema. Por favor intenta de nuevo.';
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
  } catch (error) {
    console.error('Error en webhook:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Error procesando tu mensaje.');
    res.type('text/xml').send(twiml.toString());
  }
});

app.get('/health', async (req, res) => {
  res.json({
    status: 'OK',
    bot: 'TARA™',
    timestamp: new Date().toISOString(),
    supabase: process.env.SUPABASE_URL ? 'configured' : 'missing',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
    twilio: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'missing',
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const { count: clientesCount } = await supabase.from('clientes').select('*', { count: 'exact', head: true });
    const { data: oportunidades } = await supabase.from('oportunidades').select('presupuesto_estimado, probabilidad').neq('estado', 'Ganado').neq('estado', 'Perdido');
    const pipeline = (oportunidades || []).reduce((s, o) => s + ((o.presupuesto_estimado || 0) * ((o.probabilidad || 30) / 100)), 0);
    res.json({ clientesTotales: clientesCount || 0, oportunidadesAbiertas: oportunidades?.length || 0, pipelineEstimado: Math.round(pipeline) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ bot: 'TARA™', status: 'activa', webhook: 'POST /webhook/twilio' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n============================================================');
  console.log('🚀 TARA™ INICIADA');
  console.log('============================================================');
  console.log(`Puerto: ${PORT}`);
  console.log('Webhook: /webhook/twilio');
  console.log('============================================================\n');
});

module.exports = app;
