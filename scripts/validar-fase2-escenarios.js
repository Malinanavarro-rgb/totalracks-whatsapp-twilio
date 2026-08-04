#!/usr/bin/env node
/**
 * Fase 2 — Ingeniería y Cotización: 5 escenarios completos contra la base
 * de datos real (Alina, 2026-08-04), antes de commit:
 *   1. Cliente solicita cotización genérica → entra al flujo directo.
 *   2. Cliente solicita explícitamente una visita → entra al flujo antiguo.
 *   3. Cliente manda el recibo antes de terminar las preguntas → asociado.
 *   4. El motor detecta un bloqueo → ofrece revisión/visita, no cotiza.
 *   5. Ingeniería validada queda lista para Fase 3 (y bloqueada antes).
 *
 * Usa la Empresa Demo Paneles Solares (vive-solar-mty) — limpia sus propios
 * datos de prueba al final (workflow_sessions/cotizaciones/mensajes/hilos
 * que crea), deja la base como la encontró.
 *
 * Uso: node scripts/validar-fase2-escenarios.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { WorkflowEngine } = require('../modules/workflow-engine');
const { resolverOCrearHilo, registrarMensaje } = require('../modules/inbox');
const { asociarSiHaySesionDeCotizacionActiva, listarAdjuntosDeCotizacion } = require('../modules/cotizacion-adjuntos');
const { correrCotizacionDesdeWorkflow, marcarIngenieriaValidada, puedeEnviarCotizacion } = require('../modules/cotizaciones');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b'; // Empresa Demo Paneles Solares
const CLIENTE_1 = 105; // Jorge Villarreal
const CLIENTE_2 = 106; // Marisol Cantú
const CLIENTE_3 = 107; // Refaccionaria Cantú

let fallas = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); fallas++; }
}

const engine = new WorkflowEngine(supabase);
const artefactos = { workflowSessions: [], cotizaciones: [], hilos: [], mensajes: [] };

async function limpiarSesionesActivas(clienteId) {
  await supabase.from('workflow_sessions').delete().eq('company_id', COMPANY_ID).eq('cliente_id', clienteId).eq('status', 'activo');
}

async function main() {
  console.log('\n🔬 Fase 2 — 5 escenarios completos contra la base de datos real\n');

  // ── Escenario 1 — intención genérica de cotización → flujo directo ───────
  console.log('ESCENARIO 1 — "quiero cotizar paneles" → flujo directo:');
  await limpiarSesionesActivas(CLIENTE_1);
  const workflow1 = await engine.evaluar(COMPANY_ID, ['solicitud_cotizacion']);
  assert(workflow1?.nombre === 'Cotización directa — ingeniería solar', `evaluar(['solicitud_cotizacion']) resuelve el flujo directo (fue: "${workflow1?.nombre}")`);

  const sesion1 = await engine.iniciarSesion(COMPANY_ID, CLIENTE_1, null, workflow1.id);
  artefactos.workflowSessions.push(sesion1.id);
  const nodoInicio1 = await engine.obtenerNodoActual(sesion1);
  assert(nodoInicio1?.nombre === 'preguntar_ubicacion', `la primera pregunta es "preguntar_ubicacion" (fue: "${nodoInicio1?.nombre}")`);
  await engine.abandonar(sesion1.id, nodoInicio1.nombre); // limpiar: no se completa este, solo se prueba la activación

  // ── Escenario 2 — visita técnica explícita → flujo antiguo ───────────────
  console.log('\nESCENARIO 2 — "quiero una visita técnica" → flujo antiguo (11 nodos):');
  await limpiarSesionesActivas(CLIENTE_2);
  const workflow2 = await engine.evaluar(COMPANY_ID, ['solicitud_visita_tecnica']);
  assert(workflow2?.nombre === 'Calificación completa y agenda de visita técnica solar', `evaluar(['solicitud_visita_tecnica']) resuelve el flujo de visita (fue: "${workflow2?.nombre}")`);

  const sesion2 = await engine.iniciarSesion(COMPANY_ID, CLIENTE_2, null, workflow2.id);
  artefactos.workflowSessions.push(sesion2.id);
  const nodoInicio2 = await engine.obtenerNodoActual(sesion2);
  assert(nodoInicio2?.nombre === 'preguntar_nombre', `la primera pregunta es la del flujo viejo, "preguntar_nombre" (fue: "${nodoInicio2?.nombre}")`);
  await engine.abandonar(sesion2.id, nodoInicio2.nombre);

  // Ambas intenciones juntas (mensaje ambiguo real) — debe ganar cotización
  // directa por prioridad/orden, nunca las dos a la vez.
  const workflowAmbas = await engine.evaluar(COMPANY_ID, ['solicitud_cotizacion', 'solicitud_visita_tecnica']);
  assert(!!workflowAmbas, 'con ambas intenciones detectadas, resuelve exactamente UN workflow (nunca null ni ambos)');

  // ── Escenario 3 — adjunto a mitad de la captura queda asociado ──────────
  console.log('\nESCENARIO 3 — recibo CFE llega a mitad de la captura → asociado correctamente:');
  await limpiarSesionesActivas(CLIENTE_1);
  const sesion3 = await engine.iniciarSesion(COMPANY_ID, CLIENTE_1, null, workflow1.id);
  artefactos.workflowSessions.push(sesion3.id);
  // Avanza los dos primeros nodos, simulando que el cliente ya contestó
  // ubicación/consumo — el recibo llega AQUÍ, a mitad de la captura, antes
  // de que la sesión esté completa.
  const nodo3a = await engine.obtenerNodoActual(sesion3);
  const { sesion: sesion3b, siguiente_nodo: nodo3b } = await engine.avanzar(sesion3, nodo3a, 'Monterrey, Nuevo León');
  const { sesion: sesion3c, siguiente_nodo: nodo3c } = await engine.avanzar(sesion3b, nodo3b, '600');

  const hilo3 = await resolverOCrearHilo(supabase, { company_id: COMPANY_ID, cliente_id: CLIENTE_1, canal: 'whatsapp', proveedor: 'twilio' });
  artefactos.hilos.push(hilo3.id);
  const mensaje3 = await registrarMensaje(supabase, {
    hilo_id: hilo3.id, company_id: COMPANY_ID, direccion: 'entrante', remitente_tipo: 'cliente',
    tipo_contenido: 'documento', contenido: '[recibo CFE]', adjunto_url: `${COMPANY_ID}/${hilo3.id}/recibo-prueba.pdf`, adjunto_mime: 'application/pdf',
  });
  artefactos.mensajes.push(mensaje3.id);

  const asociacion3 = await asociarSiHaySesionDeCotizacionActiva(supabase, { companyId: COMPANY_ID, clienteId: CLIENTE_1, mensajeId: mensaje3.id });
  assert(asociacion3?.cotizacion_id === null, 'el adjunto se asocia a la SESIÓN antes de que exista la cotización (cotizacion_id null)');
  assert(asociacion3?.workflow_session_id === sesion3.id, 'el adjunto queda atado a la sesión activa correcta');

  // Termina de contestar el resto de las preguntas (la sesión pasa a
  // 'completado' al llegar al nodo final, igual que en una conversación real).
  const { sesion: sesion3d, siguiente_nodo: nodo3d } = await engine.avanzar(sesion3c, nodo3c, '2400');
  const { sesion: sesion3e, siguiente_nodo: nodo3e } = await engine.avanzar(sesion3d, nodo3d, '90');
  const { sesion: sesion3f, siguiente_nodo: nodo3f } = await engine.avanzar(sesion3e, nodo3e, 'monofasica');
  const { sesion: sesion3g, siguiente_nodo: nodo3g } = await engine.avanzar(sesion3f, nodo3f, '220');
  const { completado: sesion3Completada } = await engine.avanzar(sesion3g, nodo3g, '40');
  assert(sesion3Completada === true, 'la sesión de workflow queda status=completado al llegar al nodo final');

  // Simula lo que haría el handler de ejecutar_motor_ingenieria: corre el
  // motor con los mismos datos que se acaban de capturar.
  const calculo3 = await correrCotizacionDesdeWorkflow(supabase, {
    companyId: COMPANY_ID, clienteId: CLIENTE_1,
    capturedFields: { ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '600', importe_promedio_recibo: '2400', pct_cobertura_deseado: '90', tipo_alimentacion: 'monofasica', voltaje_sitio: '220', area_disponible_m2: '40' },
  });
  artefactos.cotizaciones.push(calculo3.cotizacion_id);
  const adjuntosDeCotizacion3 = await listarAdjuntosDeCotizacion(supabase, calculo3.cotizacion_id);
  assert(adjuntosDeCotizacion3.length === 1 && adjuntosDeCotizacion3[0].mensajes?.adjunto_url?.includes('recibo-prueba.pdf'), 'al completarse la cotización, el adjunto quedó re-atado a ella (no duplicado, mismo mensaje)');

  // ── Escenario 4 — bloqueo → no cotiza, ofrece revisión/visita ───────────
  console.log('\nESCENARIO 4 — motor bloqueado (área insuficiente) → no cotiza, ofrece revisión:');
  const mensajesSeguimiento = [];
  const calculo4 = await correrCotizacionDesdeWorkflow(supabase, {
    companyId: COMPANY_ID, clienteId: CLIENTE_2,
    capturedFields: { ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '600', importe_promedio_recibo: '2400', pct_cobertura_deseado: '90', tipo_alimentacion: 'monofasica', voltaje_sitio: '220', area_disponible_m2: '5' },
    destinatario: '+528100000001',
    enviarProactivo: async (db, companyId, destinatario, texto) => { mensajesSeguimiento.push(texto); },
  });
  artefactos.cotizaciones.push(calculo4.cotizacion_id);
  assert(calculo4.estado_calculo === 'bloqueado', `estado_calculo === 'bloqueado' con área insuficiente (fue: ${calculo4.estado_calculo})`);
  assert(mensajesSeguimiento.length === 1 && /especialista/i.test(mensajesSeguimiento[0]), 'el cliente recibe el mensaje de bloqueo (revisión/visita), no una cotización');
  assert(!/adjunto/i.test(mensajesSeguimiento[0]) && !mensajesSeguimiento[0].includes('.pdf'), 'el mensaje de bloqueo nunca incluye ni promete un PDF');
  const { puede: puedeEnviar4 } = await puedeEnviarCotizacion(supabase, calculo4.cotizacion_id);
  assert(puedeEnviar4 === false, 'una cotización bloqueada NUNCA se puede enviar (puedeEnviarCotizacion === false)');

  // ── Escenario 5 — ingeniería validada, lista para Fase 3 ─────────────────
  console.log('\nESCENARIO 5 — validar ingeniería habilita el envío; sin validar, sigue bloqueado:');
  const { puede: antesDeValidar } = await puedeEnviarCotizacion(supabase, calculo3.cotizacion_id);
  assert(antesDeValidar === false, 'ANTES de validar, puedeEnviarCotizacion === false (aunque el cálculo haya salido "completo")');

  const validada = await marcarIngenieriaValidada(supabase, { cotizacionId: calculo3.cotizacion_id, usuarioId: null });
  assert(!!validada.ingenieria_validada_para_cotizar_en, 'marcarIngenieriaValidada() marca la fecha de validación');

  const { puede: despuesDeValidar } = await puedeEnviarCotizacion(supabase, calculo3.cotizacion_id);
  assert(despuesDeValidar === true, 'DESPUÉS de validar, puedeEnviarCotizacion === true — lista para que Fase 3 genere y envíe el PDF');

  // Confirmar que la MISMA validación sigue rechazada para la cotización bloqueada
  try {
    await marcarIngenieriaValidada(supabase, { cotizacionId: calculo4.cotizacion_id, usuarioId: null });
    assert(false, 'marcarIngenieriaValidada() debía rechazar la cotización bloqueada — no lo hizo');
  } catch (e) {
    assert(e.status === 409, 'marcarIngenieriaValidada() sigue rechazando la cotización bloqueada (409)');
  }

  console.log(`\n${fallas === 0 ? '✅ TODO EN VERDE — 5 escenarios completos' : `❌ ${fallas} verificación(es) fallaron`}\n`);

  // ── Limpieza ───────────────────────────────────────────────────────────
  console.log('🧹 Limpiando artefactos de prueba...');
  for (const cotId of artefactos.cotizaciones) {
    await supabase.from('cotizaciones').update({ calculo_ingenieria_id: null }).eq('id', cotId);
    await supabase.from('calculos_ingenieria').delete().eq('cotizacion_id', cotId);
    await supabase.from('cotizacion_adjuntos').delete().eq('cotizacion_id', cotId);
    await supabase.from('cotizaciones').delete().eq('id', cotId);
  }
  for (const mensajeId of artefactos.mensajes) {
    await supabase.from('cotizacion_adjuntos').delete().eq('adjunto_id', mensajeId);
    await supabase.from('mensajes').delete().eq('id', mensajeId);
  }
  for (const hiloId of artefactos.hilos) {
    await supabase.from('hilos').delete().eq('id', hiloId);
  }
  for (const sesionId of artefactos.workflowSessions) {
    await supabase.from('workflow_sessions').delete().eq('id', sesionId);
  }
  console.log('✅ Limpieza completa.\n');

  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
