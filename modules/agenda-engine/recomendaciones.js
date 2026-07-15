/**
 * TARA Matrix™ — agenda-engine/recomendaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — traduce detecciones de alertas.js en
 * tarjetas accionables, usando la terminología de agenda_config (nunca
 * "técnica"/"clienta" hardcodeado — eso es lo que separa esto de una
 * empresa a otra sin tocar código).
 *
 * Cero ejecución automática (pedido explícito): esto solo construye texto
 * y registra el evento para auditoría. Reacomodar una cita, marcar
 * inasistencia o contactar a alguien siempre pasa por un endpoint aparte,
 * disparado por un clic explícito de la usuaria en el frontend.
 *
 * @module modules/agenda-engine/recomendaciones
 */

'use strict';

function _cap(texto) {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

const SEVERIDAD_POR_TIPO = {
  retraso:           'critica',
  no_show_candidato: 'critica',
  riesgo_tarde:       'critica',
  saturacion:         'media',
  tiempo_muerto:      'info',
  hueco_insertable:   'info',
};

const ACCION_POR_TIPO = {
  retraso:           { accion: 'confirmar_llegada', accionTexto: 'Confirmar' },
  no_show_candidato: { accion: 'marcar_no_show',      accionTexto: 'Marcar inasistencia' },
  riesgo_tarde:       { accion: 'reacomodar',          accionTexto: 'Reacomodar' },
  saturacion:         { accion: 'reacomodar',          accionTexto: 'Ver agenda' },
  tiempo_muerto:      { accion: 'ver_hueco',           accionTexto: 'Ver hueco' },
  hueco_insertable:   { accion: 'llenar_hueco',        accionTexto: 'Ofrecer espacio' },
};

/**
 * @param {Array} detecciones - una entrada por alerta detectada, ya
 *   etiquetada con asesorId/asesorNombre por quien la generó (index.js),
 *   con la forma { tipo, asesorId, asesorNombre, ...datosDeAlertas.js }.
 * @param {Object} agendaConfig - config.terminologia se usa para el texto.
 * @returns {Array<Object>} tarjetas listas para el feed + para registrarEvento().
 */
function construirRecomendaciones(detecciones, agendaConfig) {
  const term = agendaConfig.terminologia;
  const bloque = term.bloque.singular;
  const contacto = term.contacto.singular;

  return (detecciones || []).map((d) => {
    const base = {
      tipo_regla: d.tipo,
      severidad: SEVERIDAD_POR_TIPO[d.tipo] || 'info',
      asesor_id: d.asesorId || null,
      cita_id: d.cita?.id || null,
      ...ACCION_POR_TIPO[d.tipo],
    };

    switch (d.tipo) {
      case 'retraso': {
        const cliente = d.cita?.clientes?.nombre || contacto;
        return { ...base,
          texto: `${_cap(bloque)} de ${cliente} con ${d.asesorNombre} lleva ${d.minutosRetraso} min de retraso.`,
          detalle: `Programada para ${new Date(d.cita.inicio).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.`,
        };
      }
      case 'no_show_candidato': {
        const cliente = d.cita?.clientes?.nombre || contacto;
        return { ...base,
          texto: `${cliente} no ha llegado a su ${bloque.toLowerCase()} con ${d.asesorNombre} — ${d.minutosSinLlegar} min sin confirmar.`,
          detalle: `¿La marcamos como inasistencia?`,
        };
      }
      case 'riesgo_tarde':
        return { ...base,
          texto: `${d.asesorNombre} corre riesgo de terminar ${d.minutosExceso} min tarde hoy.`,
          detalle: `Retraso acumulado: ${d.minutosRetrasoTotal} min. ¿Reacomodamos alguna ${bloque.toLowerCase()}?`,
        };
      case 'saturacion':
        return { ...base,
          texto: `${d.asesorNombre} tiene ${d.cantidad} ${term.bloque.plural.toLowerCase()} seguidas sin descanso.`,
          detalle: `Riesgo de fatiga o de retrasos en cascada.`,
        };
      case 'tiempo_muerto':
        return { ...base,
          texto: `${d.asesorNombre} lleva ${d.minutos} min sin actividad.`,
          detalle: `Buen momento para promoción o reacomodo.`,
        };
      case 'hueco_insertable':
        return { ...base,
          texto: `${d.asesorNombre} tiene ${d.hueco.minutos} min libres — alcanza para ${d.serviciosQueCaben.map(s => s.nombre).join(', ')}.`,
          detalle: `¿Ofrecemos este espacio a alguna ${contacto.toLowerCase()}?`,
        };
      default:
        return { ...base, texto: 'Detección sin plantilla de texto configurada.', detalle: '' };
    }
  });
}

/**
 * Registra un evento de auditoría — con deduplicación: no crea un segundo
 * "pendiente" para la misma detección mientras el anterior siga sin
 * resolver (evita spamear el feed en cada refresco).
 */
async function registrarEvento(supabase, company_id, evento) {
  let query = supabase
    .from('agenda_eventos')
    .select('id')
    .eq('company_id', company_id)
    .eq('tipo_regla', evento.tipo_regla)
    .eq('estado', 'pendiente');

  query = evento.cita_id ? query.eq('cita_id', evento.cita_id) : query.eq('asesor_id', evento.asesor_id);

  const { data: existente } = await query.maybeSingle();
  if (existente) return existente;

  const { data, error } = await supabase
    .from('agenda_eventos')
    .insert({
      company_id,
      tipo_regla: evento.tipo_regla,
      cita_id: evento.cita_id || null,
      asesor_id: evento.asesor_id || null,
      detectado: evento.detectado || {},
      sugerencia: evento.texto,
    })
    .select()
    .single();

  if (error) throw new Error(`agenda-engine/recomendaciones.registrarEvento: ${error.message}`);
  return data;
}

async function resolverEvento(supabase, company_id, eventoId, { estado, accion_tomada, resultado }) {
  const { data, error } = await supabase
    .from('agenda_eventos')
    .update({ estado, accion_tomada: accion_tomada || null, resultado: resultado || null, resuelto_en: new Date().toISOString() })
    .eq('id', eventoId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo resolver el evento de agenda');
  return data;
}

module.exports = {
  SEVERIDAD_POR_TIPO,
  ACCION_POR_TIPO,
  construirRecomendaciones,
  registrarEvento,
  resolverEvento,
};
