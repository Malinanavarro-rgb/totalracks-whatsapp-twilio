/**
 * ============================================================
 * TARA - Bot Inteligente para Total Racks
 * Twilio + Supabase + OpenAI
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const twilio = require('twilio');

// ============================================================
// INICIALIZAR CLIENTES
// ============================================================

const app = express();
app.use(express.urlencoded({ extended: false }));

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { 'Accept-Encoding': 'identity' },
});

// Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

/**
 * Obtener o crear cliente en Supabase
 */
async function obtenerOCrearCliente(telefono, nombre = null) {
  try {
    // Buscar cliente existente
    const { data: clienteExistente } = await supabase
      .from('clientes')
      .select('*')
      .eq('telefono', telefono)
      .maybeSingle();

    if (clienteExistente) {
      return clienteExistente;
    }

    // Crear nuevo cliente
    const { data: clienteNuevo, error } = await supabase
      .from('clientes')
      .insert([
        {
          telefono,
          nombre: nombre || 'Sin nombre',
          ciudad: 'Monterrey',
          fuente: 'WhatsApp',
          estado: 'Nuevo',
          score_interes: 0,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Error creando cliente:', error);
      return null;
    }

    console.log(`✅ Cliente creado: ${telefono}`);
    return clienteNuevo;
  } catch (error) {
    console.error('Error en obtenerOCrearCliente:', error);
    return null;
  }
}

/**
 * Guardar conversación en Supabase
 */
async function guardarConversacion(
  clienteId,
  mensajeCliente,
  respuestaTara,
  tipoRack = null,
  intenciones = []
) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .insert([
        {
          cliente_id: clienteId,
          mensaje_cliente: mensajeCliente,
          respuesta_tara: respuestaTara,
          tipo_rack_detectado: tipoRack,
          intenciones: intenciones,
          sentimiento: 'Neutral',
        },
      ])
      .select();

    if (error) throw error;
    console.log(`✅ Conversación guardada para cliente ${clienteId}`);
    return data[0];
  } catch (error) {
    console.error('Error guardando conversación:', error);
    return null;
  }
}

/**
 * Analizar mensaje con OpenAI (con historial de conversación)
 */
async function analizarConOpenAI(mensajeCliente, historial = []) {
  try {
    const systemPrompt = `Eres TARA™, especialista virtual de Total Racks, empresa líder en racks industriales en Monterrey, NL, México.

CONOCIMIENTO EXPERTO:
- Rack Selectivo: el más versátil. Para tarimas/pallets de alta rotación, acceso individual a cada posición. Ideal para productos variados (SKUs mixtos). Capacidad por nivel: 500-2000 kg. Alturas de 3 a 12 metros.
- Drive-In / Drive-Through: máxima densidad de almacenamiento. Para productos homogéneos de baja rotación (LIFO) o alta (FIFO en drive-through). Reduce pasillos al mínimo.
- Cantilever: para material largo sin embalaje (tubos, perfiles, madera, rollos). Sin columnas frontales que obstruyan la carga.
- Flow Rack (gravedad): para operaciones FIFO de alta rotación. Producto entra por atrás y sale por el frente. Ideal para perecederos y líneas de producción.
- Entrepiso Industrial: aprovecha la altura del almacén creando un segundo piso. Para picking manual, oficinas o archivo.
- Lockers Industriales: para equipo personal, herramientas o valuables.

VENTAJA EXCLUSIVA TOTAL RACKS: único proveedor en el noreste que incluye sistema digital propio para visualizar capacidad e inventario en tiempo real, sin costo adicional de software.

PROCESO DE VENTA:
1. Saludar y preguntar qué necesitan almacenar
2. Obtener: tipo de producto, peso por unidad, dimensiones del almacén, cantidad de posiciones, tipo de operación (FIFO/LIFO/mixto)
3. Recomendar el rack específico con justificación técnica
4. Ofrecer cotización y mencionar ventaja del sistema digital
5. Capturar datos de contacto si el cliente muestra interés

REGLAS:
- Responde en español, máximo 120 palabras
- Sé proactivo: si tienes suficiente información, HAZ la recomendación concreta (no sigas pidiendo datos)
- Recuerda el contexto de mensajes anteriores de esta conversación
- Si preguntan por precio, menciona que depende de dimensiones y cantidad pero que son competitivos e incluyen instalación y sistema digital
- Nunca inventes precios específicos sin cotización formal

Responde SOLO en JSON sin markdown:
{
  "tipo_rack": "Selectivo|Cantilever|Drive In|Flow Rack|Entrepiso|Sin clasificar",
  "intenciones": ["precio", "consulta", "cotizacion", "recomendacion"],
  "sentimiento": "Positivo|Neutral|Negativo|Muy interesado",
  "respuesta_tara": "tu respuesta experta aquí"
}`;

    const mensajes = [{ role: 'system', content: systemPrompt }];

    for (const h of historial) {
      mensajes.push({ role: 'user', content: h.mensaje_cliente });
      mensajes.push({ role: 'assistant', content: h.respuesta_tara });
    }

    mensajes.push({ role: 'user', content: mensajeCliente });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajes,
      temperature: 0.7,
      max_tokens: 600,
    });

    let contenido = response.choices[0].message.content.trim();
    contenido = contenido.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    return JSON.parse(contenido);
  } catch (error) {
    console.error('Error en OpenAI:', error);
    return {
      tipo_rack: 'Sin clasificar',
      intenciones: ['consulta'],
      sentimiento: 'Neutral',
      respuesta_tara: '¡Hola! Soy TARA™ de Total Racks. ¿En qué puedo ayudarte hoy con tu proyecto de almacenamiento?',
    };
  }
}

/**
 * Crear oportunidad si el cliente muestra interés
 */
async function crearOportunidadSiNecesario(clienteId, tipoRack, intenciones) {
  if (intenciones.includes('cotizacion') || intenciones.includes('compra')) {
    try {
      const { data: oportunidadesExistentes } = await supabase
        .from('oportunidades')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('tipo_rack', tipoRack)
        .neq('estado', 'Perdido')
        .limit(1);

      if (!oportunidadesExistentes || oportunidadesExistentes.length === 0) {
        const { data, error } = await supabase
          .from('oportunidades')
          .insert([
            {
              cliente_id: clienteId,
              tipo_rack: tipoRack,
              estado: 'Calificado',
              probabilidad: 45,
              descripcion: `Cliente interesado en ${tipoRack}`,
            },
          ])
          .select();

        if (error) throw error;
        console.log(`✅ Oportunidad creada: ${tipoRack} para cliente ${clienteId}`);
        return data[0];
      }
    } catch (error) {
      console.error('Error creando oportunidad:', error);
    }
  }
  return null;
}

/**
 * Procesar mensaje de Twilio
 */
async function procesarMensajeTwilio(telefono, mensajeCliente) {
  try {
    console.log(`\n📱 Mensaje de ${telefono}: ${mensajeCliente}`);

    // 1. Obtener o crear cliente
    const cliente = await obtenerOCrearCliente(telefono);
    if (!cliente) {
      return 'Disculpa, tuve un problema procesando tu solicitud. Intenta de nuevo.';
    }

    // 2. Obtener historial reciente
    const { data: historial } = await supabase
      .from('conversaciones')
      .select('mensaje_cliente, respuesta_tara')
      .eq('cliente_id', cliente.id)
      .order('created_at', { ascending: false })
      .limit(5);
    const historialOrdenado = (historial || []).reverse();

    // 3. Analizar con OpenAI
    const analisis = await analizarConOpenAI(mensajeCliente, historialOrdenado);

    // 4. Guardar conversación
    await guardarConversacion(
      cliente.id,
      mensajeCliente,
      analisis.respuesta_tara,
      analisis.tipo_rack,
      analisis.intenciones
    );

    // 5. Crear oportunidad si es necesario
    if (analisis.intenciones.includes('cotizacion')) {
      await crearOportunidadSiNecesario(
        cliente.id,
        analisis.tipo_rack,
        analisis.intenciones
      );
    }

    // 6. Actualizar score
    const nuevoScore = (cliente.score_interes || 0) + 10;
    await supabase
      .from('clientes')
      .update({ score_interes: Math.min(nuevoScore, 100) })
      .eq('id', cliente.id);

    console.log(`✅ Respuesta lista: ${analisis.respuesta_tara}`);
    return analisis.respuesta_tara;
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    return 'Disculpa, tuve un problema. Por favor intenta de nuevo.';
  }
}

// ============================================================
// RUTAS
// ============================================================

/**
 * Webhook de Twilio WhatsApp
 */
app.post('/webhook/twilio', async (req, res) => {
  try {
    const telefono = req.body.From.replace('whatsapp:', '');
    const mensajeCliente = req.body.Body;

    const respuestaTara = await procesarMensajeTwilio(telefono, mensajeCliente);

    // Enviar respuesta a Twilio
    const response = new twilio.twiml.MessagingResponse();
    response.message(respuestaTara);

    res.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('Error en webhook:', error);
    const response = new twilio.twiml.MessagingResponse();
    response.message('Error procesando tu mensaje.');
    res.type('text/xml').send(response.toString());
  }
});

/**
 * Health Check
 */
app.get('/health', async (req, res) => {
  try {
    // Verificar Supabase
    const { data: supabaseOk } = await supabase.from('clientes').select('count', { count: 'exact', head: true });
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      supabase: 'connected',
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
      twilio: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'missing',
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
    });
  }
});

/**
 * Dashboard Rápido (JSON)
 */
app.get('/api/dashboard', async (req, res) => {
  try {
    // Clientes nuevos
    const { count: clientesCount } = await supabase
      .from('clientes')
      .select('count', { count: 'exact', head: true });

    // Oportunidades
    const { data: oportunidades } = await supabase
      .from('oportunidades')
      .select('presupuesto_estimado, probabilidad')
      .neq('estado', 'Ganado')
      .neq('estado', 'Perdido');

    // Calcular pipeline
    let pipelineTotal = 0;
    if (oportunidades) {
      pipelineTotal = oportunidades.reduce((sum, opp) => {
        const est = opp.presupuesto_estimado || 0;
        const prob = (opp.probabilidad || 30) / 100;
        return sum + est * prob;
      }, 0);
    }

    res.json({
      clientesTotales: clientesCount || 0,
      oportunidadesAbiertas: oportunidades?.length || 0,
      pipelineEstimado: Math.round(pipelineTotal),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Raiz
 */
app.get('/', (req, res) => {
  res.json({
    mensaje: '🤖 TARA está activo',
    version: '1.0.0',
    endpoints: {
      webhook: 'POST /webhook/twilio',
      health: 'GET /health',
      dashboard: 'GET /api/dashboard',
    },
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 TARA INICIADO');
  console.log('='.repeat(60));
  console.log(`\nServidor escuchando en puerto: ${PORT}`);
  console.log(`Webhook Twilio: http://localhost:${PORT}/webhook/twilio`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Dashboard: http://localhost:${PORT}/api/dashboard`);
  console.log('\n' + '='.repeat(60) + '\n');
});

module.exports = app;
