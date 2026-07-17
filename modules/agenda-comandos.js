/**
 * TARA Matrix™ — agenda-comandos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ⌘K con lenguaje natural — patrón "interpretar → confirmar → ejecutar",
 * pensado como base reutilizable para cualquier acción futura de TARA
 * disparada por texto libre.
 *
 * Regla no negociable: ninguna acción que modifique datos se ejecuta al
 * interpretar. `interpretarComando()` solo entiende la intención y la deja
 * pendiente de confirmación (persistida en `agenda_comandos`); recién
 * `confirmarComando()` — disparado por un clic explícito de la usuaria —
 * ejecuta, y lo hace despachando a funciones YA EXISTENTES y probadas
 * (`modules/agenda.js`, `modules/agenda-engine/recomendaciones.js`). Esta
 * IA nunca escribe directo a `citas` — solo interpreta texto y arma
 * parámetros, igual de deliberado que el resto del motor (Fase 1).
 *
 * Mismo patrón de llamada a OpenAI que modules/asistente-consultas.js
 * (única precedente en el proyecto), con response_format json_object para
 * forzar salida estructurada.
 *
 * @module modules/agenda-comandos
 */

'use strict';

const { openai } = require('./clients');
const { listarCitas, reagendarCita, cancelarCita, marcarNoShow } = require('./agenda');
const { resolverEvento } = require('./agenda-engine/recomendaciones');

const INTENCIONES_MUTANTES = ['reagendar_cita', 'cancelar_cita', 'confirmar_llegada', 'marcar_no_show'];

const SYSTEM_PROMPT = [
  'Eres TARA, la asistente operativa de esta empresa. Interpretas lo que la usuaria escribe en la barra de comando (⌘K) de la Agenda.',
  'Responde ÚNICAMENTE con un objeto JSON, sin texto fuera del JSON, con esta forma exacta:',
  '{"intencion": "reagendar_cita|cancelar_cita|confirmar_llegada|marcar_no_show|consulta|no_reconocido", "entidades": {}, "resumen": "", "respuesta": ""}',
  '',
  'Reglas estrictas:',
  '- reagendar_cita: entidades = {"cita_id": "...", "nuevo_inicio": "ISO 8601"}. resumen = frase confirmando qué se moverá y a qué hora nueva, ej: "Mover la cita de Valeria Cruz de las 11:00 a las 4:00 pm".',
  '- cancelar_cita: entidades = {"cita_id": "..."}. resumen = frase confirmando qué cita se cancelará.',
  '- confirmar_llegada: entidades = {"cita_id": "..."}. resumen = frase confirmando que se marca como confirmada la llegada de esa clienta.',
  '- marcar_no_show: entidades = {"cita_id": "..."}. resumen = frase confirmando que se marcará inasistencia.',
  '- consulta: entidades = {}. resumen = "". respuesta = la respuesta real, basada ÚNICAMENTE en la lista de citas de hoy que se te da abajo — si no tienes el dato para responder con certeza, dilo directamente, nunca inventes un número o un nombre.',
  '- no_reconocido: úsalo si el texto no corresponde a ninguna acción anterior, si no puedes identificar con certeza a qué cita se refiere, o si hay más de una coincidencia posible (ej. dos clientas con nombre parecido). entidades = {}. resumen = una pregunta corta pidiendo aclarar, en "respuesta".',
  '- SOLO puedes usar un "cita_id" que aparezca literalmente en la lista de citas de hoy — nunca inventes uno.',
  '- "nuevo_inicio" siempre en fecha ISO 8601 completa, usando la fecha de hoy que se te da, salvo que la usuaria mencione explícitamente otro día.',
].join('\n');

function _armarContextoCitas(citas, ahoraIso) {
  const lista = citas.map(c => ({
    cita_id: c.id,
    cliente: c.clientes?.nombre || c.clientes?.telefono || 'sin nombre',
    asesor: c.asesores?.nombre || 'sin asignar',
    inicio: c.inicio,
    fin: c.fin,
    estado: c.estado,
  }));
  return `Hora actual: ${ahoraIso}\n\nCitas de hoy:\n${JSON.stringify(lista, null, 2)}`;
}

/**
 * @returns {Promise<{ requiere_confirmacion: boolean, comando_id?: string, resumen?: string, respuesta?: string }>}
 */
async function interpretarComando(supabase, company_id, usuario, texto) {
  const ahora = new Date();
  const inicioDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const finDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 23, 59, 59)).toISOString();

  const citas = await listarCitas(supabase, company_id, usuario, { desde: inicioDia, hasta: finDia });
  const contexto = _armarContextoCitas(citas, ahora.toISOString());

  let interpretado;
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${contexto}\n\nTexto de la usuaria: "${texto}"` },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });
    interpretado = JSON.parse(response.choices[0].message.content);
  } catch (e) {
    console.error('Error en agenda-comandos.interpretarComando:', e.message);
    return { requiere_confirmacion: false, respuesta: 'No pude interpretar eso en este momento — intenta de nuevo en unos segundos.' };
  }

  const intencion = interpretado.intencion;

  if (!INTENCIONES_MUTANTES.includes(intencion)) {
    // 'consulta' o 'no_reconocido': nunca se persiste, es de solo lectura.
    return { requiere_confirmacion: false, respuesta: interpretado.respuesta || 'No entendí bien esa solicitud — ¿puedes reformularla?' };
  }

  // Valida que el cita_id referenciado exista de verdad entre las citas de
  // hoy — nunca se confía ciegamente en lo que devolvió el modelo.
  const citaId = interpretado.entidades?.cita_id;
  const citaValida = citas.find(c => String(c.id) === String(citaId));
  if (!citaValida) {
    return { requiere_confirmacion: false, respuesta: 'No encontré con certeza a qué cita te refieres — ¿puedes ser más específica?' };
  }

  const entidades = { ...interpretado.entidades };
  if (intencion === 'reagendar_cita' && entidades.nuevo_inicio) {
    // Se conserva la duración original de la cita — el modelo solo decide
    // la nueva hora de inicio, nunca inventa cuánto dura el servicio.
    const duracionMs = new Date(citaValida.fin).getTime() - new Date(citaValida.inicio).getTime();
    entidades.nuevo_fin = new Date(new Date(entidades.nuevo_inicio).getTime() + duracionMs).toISOString();
  }

  const { data, error } = await supabase
    .from('agenda_comandos')
    .insert({
      company_id,
      usuario_id: usuario.id,
      texto_original: texto,
      intencion,
      entidades,
      resumen: interpretado.resumen || '',
    })
    .select()
    .single();

  if (error) throw new Error(`agenda-comandos.interpretarComando: ${error.message}`);

  return { requiere_confirmacion: true, comando_id: data.id, resumen: data.resumen };
}

async function _obtenerComandoPendiente(supabase, company_id, comandoId) {
  const { data, error } = await supabase
    .from('agenda_comandos')
    .select('*')
    .eq('id', comandoId)
    .eq('company_id', company_id)
    .maybeSingle();

  if (error || !data) {
    const err = new Error('Comando no encontrado');
    err.status = 404;
    throw err;
  }
  if (data.estado !== 'pendiente_confirmacion') {
    const err = new Error('Este comando ya fue resuelto');
    err.status = 409;
    throw err;
  }
  return data;
}

/**
 * Ejecuta exactamente la acción ya interpretada y persistida — nunca
 * recibe parámetros nuevos del cliente, solo el id del comando pendiente.
 */
async function confirmarComando(supabase, company_id, usuario, comandoId) {
  const comando = await _obtenerComandoPendiente(supabase, company_id, comandoId);
  const { cita_id, nuevo_inicio, nuevo_fin } = comando.entidades || {};

  let resultado;
  try {
    if (comando.intencion === 'reagendar_cita') {
      const cita = await reagendarCita(supabase, company_id, usuario, cita_id, new Date(nuevo_inicio), new Date(nuevo_fin));
      resultado = { ok: true, cita };
    } else if (comando.intencion === 'cancelar_cita') {
      const cita = await cancelarCita(supabase, company_id, usuario, cita_id);
      resultado = { ok: true, cita };
    } else if (comando.intencion === 'marcar_no_show') {
      const cita = await marcarNoShow(supabase, company_id, usuario, cita_id);
      await _resolverEventoSiExiste(supabase, company_id, cita_id, 'no_show_candidato', comando);
      resultado = { ok: true, cita };
    } else if (comando.intencion === 'confirmar_llegada') {
      const resuelto = await _resolverEventoSiExiste(supabase, company_id, cita_id, 'retraso', comando);
      resultado = { ok: true, evento: resuelto };
    } else {
      throw new Error(`Intención no ejecutable: ${comando.intencion}`);
    }
  } catch (e) {
    await supabase.from('agenda_comandos')
      .update({ estado: 'error', resultado: { error: e.message }, resuelto_en: new Date().toISOString() })
      .eq('id', comandoId).eq('company_id', company_id);
    throw e;
  }

  const { data } = await supabase
    .from('agenda_comandos')
    .update({ estado: 'ejecutado', resultado, resuelto_en: new Date().toISOString() })
    .eq('id', comandoId).eq('company_id', company_id)
    .select().single();

  return data;
}

async function _resolverEventoSiExiste(supabase, company_id, citaId, tipoRegla, comando) {
  const { data: evento } = await supabase
    .from('agenda_eventos')
    .select('id')
    .eq('company_id', company_id)
    .eq('cita_id', citaId)
    .eq('tipo_regla', tipoRegla)
    .eq('estado', 'pendiente')
    .maybeSingle();

  if (!evento) return null;
  return resolverEvento(supabase, company_id, evento.id, {
    estado: 'aceptada',
    accion_tomada: { tipo: 'via_comando', comando_id: comando.id },
    resultado: comando.resumen,
  });
}

async function cancelarComando(supabase, company_id, comandoId) {
  const { data, error } = await supabase
    .from('agenda_comandos')
    .update({ estado: 'cancelado', resuelto_en: new Date().toISOString() })
    .eq('id', comandoId)
    .eq('company_id', company_id)
    .eq('estado', 'pendiente_confirmacion')
    .select()
    .maybeSingle();

  if (error || !data) {
    const err = new Error('Comando no encontrado o ya resuelto');
    err.status = 404;
    throw err;
  }
  return data;
}

module.exports = { interpretarComando, confirmarComando, cancelarComando };
