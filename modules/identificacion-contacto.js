/**
 * TARA Matrix™ — identificacion-contacto.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Identificación obligatoria de contacto (Alina, 2026-10-16, autorizada
 * tras TARA_IDENTIFICACION_CONTACTO_DIAGNOSTICO_V1.md). Mismo esqueleto
 * que modules/clasificacion-cliente.js: una jerarquía de confianza de
 * fuente (manual > cliente > ia_inferido) donde nunca se sobreescribe con
 * algo de MENOR confianza — pero SÍ se actualiza con un valor nuevo de la
 * MISMA fuente, lo que permite que un cliente corrija su nombre o cambie
 * de motivo sin quedar atascado en el primer dato que dio.
 *
 * El Core (modules/orchestrator.js) nunca importa este módulo directo —
 * lo invoca vía dependencia inyectada (`actualizarIdentificacion`), mismo
 * patrón que `actualizarClasificacion`/`registrarConsumoIA`.
 *
 * @module modules/identificacion-contacto
 */

'use strict';

// PRIORIDAD 3 (incidente cotización 83/COT-2026-0021, 2026-10-16): única
// lista de qué acciones comerciales requieren identificación — antes vivía
// duplicada como ACCIONES_REQUIEREN_IDENTIFICACION dentro de
// orchestrator.js; ahora un solo lugar, reexportado desde ahí para no
// romper nada que ya la importaba.
const ACCIONES_REQUIEREN_IDENTIFICACION = ['crear_oportunidad', 'agendar_cita', 'agendar_cita_con_horario_solicitado', 'ejecutar_motor_ingenieria'];

const ORDEN_CONFIANZA = { manual: 3, cliente: 2, ia_inferido: 1 };

function _debeActualizar(fuenteActual, fuenteNueva) {
  const actual = ORDEN_CONFIANZA[fuenteActual] || 0;
  const nueva = ORDEN_CONFIANZA[fuenteNueva] || 0;
  return nueva >= actual;
}

/**
 * Estados derivados de los datos ya existentes — nunca una tabla/columna
 * de estado aparte (pedido explícito: "evita crear una tabla adicional de
 * estados si estos pueden derivarse de los datos existentes").
 *
 * @returns {'sin_identificar'|'parcial'|'identificado'}
 */
function resolverEstadoIdentificacion({ nombre, motivoConsulta }) {
  const tieneNombre = !!nombre && nombre !== 'Sin nombre';
  const tieneMotivo = !!motivoConsulta;
  if (tieneNombre && tieneMotivo) return 'identificado';
  if (tieneNombre || tieneMotivo) return 'parcial';
  return 'sin_identificar';
}

/**
 * Persiste nombre/motivo_consulta de un cliente — SIEMPRE con fuente
 * 'cliente' (lo que llega aquí ya pasó la validación del Orchestrator:
 * solo lo que el cliente dijo en ESE turno, nunca inferido por la IA).
 * Nunca lanza. Nunca sobreescribe con vacío. Nunca pisa una corrección
 * 'manual' hecha desde el CRM con algo de menor confianza.
 *
 * Nota de alcance (documentada, no resuelta aquí): `clientes.nombre` no
 * tiene columna de "fuente" propia (ya existía en el esquema antes de esta
 * fase) — se actualiza cuando el cliente da un valor distinto al actual,
 * lo cual permite correcciones, pero no distingue todavía un nombre fijado
 * manualmente desde el CRM de uno conversacional. Ver riesgo documentado
 * en la entrega.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} clienteId
 * @param {string} companyId
 * @param {{nombre?: string|null, motivo?: string|null}} datos - ya validados por el caller
 */
async function actualizarIdentificacionAutomatica(supabase, clienteId, companyId, { nombre, motivo } = {}) {
  if (!clienteId || (!nombre && !motivo)) return;

  try {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('nombre, motivo_consulta, motivo_consulta_fuente')
      .eq('id', clienteId).eq('company_id', companyId).maybeSingle();
    if (!cliente) return;

    const cambios = {};
    if (nombre && nombre !== cliente.nombre) {
      cambios.nombre = nombre;
    }
    if (motivo && motivo !== cliente.motivo_consulta && _debeActualizar(cliente.motivo_consulta_fuente, 'cliente')) {
      cambios.motivo_consulta = motivo;
      cambios.motivo_consulta_fuente = 'cliente';
      cambios.motivo_consulta_actualizado_en = new Date().toISOString();
    }

    if (Object.keys(cambios).length === 0) return;

    await supabase.from('clientes').update(cambios).eq('id', clienteId).eq('company_id', companyId);
  } catch (e) {
    console.error('identificacion-contacto.actualizarIdentificacionAutomatica:', e.message);
  }
}

/**
 * ÚNICA función de autorización para las 4 acciones comerciales que
 * requieren identificación — PRIORIDAD 3 (incidente cotización 83,
 * 2026-10-16): antes de esto, cada camino (A, B, C) repetía su propio
 * chequeo "ACCIONES_REQUIEREN_IDENTIFICACION.includes(...) && estado !==
 * 'identificado'" por separado — el camino C directamente no lo tenía.
 * Ahora los 3 caminos llaman a ESTA función, nunca reimplementan el
 * criterio.
 *
 * Recibe exclusivamente datos ya resueltos por el backend
 * (company_id/cliente_id de la sesión/webhook ya autenticados, nombre/
 * motivoConsulta ya combinados y validados por el caller — nunca texto
 * crudo del modelo sin pasar primero por _validarDatoContacto()/
 * resolverIdentificacion() del caller). El modelo nunca llega hasta aquí
 * con la capacidad de decidir el resultado — ni siquiera conoce que esta
 * función existe.
 *
 * @param {Object} datos
 * @param {string} datos.tipoAccion
 * @param {string} [datos.companyId]
 * @param {string|number} [datos.clienteId]
 * @param {string|null} [datos.nombre]
 * @param {string|null} [datos.motivoConsulta]
 * @returns {{autorizada: boolean, motivo?: string, campoFaltante?: 'nombre'|'motivo'}}
 */
function puedeEjecutarseAccionComercial({ tipoAccion, companyId, clienteId, nombre, motivoConsulta } = {}) {
  if (!ACCIONES_REQUIEREN_IDENTIFICACION.includes(tipoAccion)) {
    return { autorizada: true };
  }
  if (!companyId || !clienteId) {
    return { autorizada: false, motivo: 'sin_contexto_valido' };
  }

  const estado = resolverEstadoIdentificacion({ nombre, motivoConsulta });
  if (estado !== 'identificado') {
    const tieneNombre = !!nombre && nombre !== 'Sin nombre';
    return { autorizada: false, motivo: 'identificacion_incompleta', campoFaltante: tieneNombre ? 'motivo' : 'nombre' };
  }

  return { autorizada: true };
}

module.exports = {
  actualizarIdentificacionAutomatica, resolverEstadoIdentificacion, puedeEjecutarseAccionComercial,
  ACCIONES_REQUIEREN_IDENTIFICACION, ORDEN_CONFIANZA,
};
