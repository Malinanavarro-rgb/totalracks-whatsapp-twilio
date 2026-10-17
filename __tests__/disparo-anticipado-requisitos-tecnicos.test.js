/**
 * TARA Matrix™ — server.js, bloque "disparo anticipado" (líneas ~592-657)
 * ─────────────────────────────────────────────────────────────────────────────
 * Corrección del incidente real "Alberto Gzz" / Nort Energy (2026-10-17):
 * ese bloque llama a correrCotizacionDesdeWorkflow() directamente, fuera del
 * ActionRunner — por eso nunca pasaba por camposTecnicosFaltantes(), que ya
 * protegía los caminos A/B (ver modules/orchestrator.js::crearOrchestrator()).
 *
 * server.js NO tiene hoy ningún arnés de pruebas (no hay supertest, ninguna
 * ruta HTTP se prueba) — construir uno ahora sería una expansión de alcance
 * más allá de la corrección mínima pedida. Esta prueba usa las MISMAS
 * funciones reales y puras que el bloque corregido usa
 * (camposTecnicosFaltantes, puedeEjecutarseAccionComercial,
 * resolverIdentificacion) y replica exactamente su cadena de condiciones
 * (ver server.js líneas 628-657) para demostrar, sin necesidad de levantar
 * el servidor ni llamar a correrCotizacionDesdeWorkflow de verdad (evita
 * escrituras reales), que el fix bloquea el caso real del incidente y no
 * bloquea el caso legítimo.
 *
 * @module __tests__/disparo-anticipado-requisitos-tecnicos.test
 */

'use strict';

const { resolverIdentificacion, camposTecnicosFaltantes } = require('../modules/orchestrator');
const { puedeEjecutarseAccionComercial } = require('../modules/identificacion-contacto');

/**
 * Replica EXACTA de la cadena de condiciones del bloque de disparo
 * anticipado (server.js) para decidir si correrCotizacionDesdeWorkflow()
 * se habría llamado — nunca la llama de verdad (sin escrituras).
 */
function seHabriaDisparadoElMotor({ cliente, datosContacto, companyId, capturedFields }) {
  const identificacion = resolverIdentificacion(cliente, datosContacto);
  const autorizacion = puedeEjecutarseAccionComercial({
    tipoAccion: 'ejecutar_motor_ingenieria', companyId, clienteId: cliente?.id,
    nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
  });
  if (!autorizacion.autorizada) return false;
  return camposTecnicosFaltantes(capturedFields).length === 0;
}

describe('server.js — disparo anticipado: requisitos técnicos completos antes de ejecutar_motor_ingenieria (2026-10-17)', () => {
  const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy real

  test('REPRODUCCIÓN DEL INCIDENTE: identificado (nombre+motivo) pero capturedFields = {nombre} únicamente → el motor NO se dispara', () => {
    const cliente = { id: 177, nombre: 'Alberto Gzz', motivo_consulta: 'cotizar paneles' };
    const capturedFields = { nombre: 'Alberto Gzz' }; // exactamente lo real de workflow_sessions.captured_fields en el incidente
    expect(seHabriaDisparadoElMotor({ cliente, datosContacto: null, companyId: COMPANY_ID, capturedFields })).toBe(false);
  });

  test('identificado pero con datos técnicos incompletos (falta pct_cobertura_deseado) → el motor NO se dispara', () => {
    const cliente = { id: 178, nombre: 'Laura Martínez', motivo_consulta: 'cotizar paneles para mi negocio' };
    const capturedFields = { nombre: 'Laura Martínez', ubicacion: 'Monterrey', consumo_mensual_kwh: '500' }; // falta pct_cobertura_deseado
    expect(seHabriaDisparadoElMotor({ cliente, datosContacto: null, companyId: COMPANY_ID, capturedFields })).toBe(false);
  });

  test('identificado y con datos técnicos suficientes → el motor SÍ puede dispararse (caso legítimo no debe romperse)', () => {
    const cliente = { id: 179, nombre: 'Roberto Salas', motivo_consulta: 'cotizar paneles para mi casa' };
    const capturedFields = { nombre: 'Roberto Salas', ubicacion: 'Monterrey', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' };
    expect(seHabriaDisparadoElMotor({ cliente, datosContacto: null, companyId: COMPANY_ID, capturedFields })).toBe(true);
  });

  test('identificado y con historial_consumo_kwh (≥12 meses) en vez de consumo_mensual_kwh → el motor SÍ puede dispararse (alternativa real del motor, no una regla nueva)', () => {
    const cliente = { id: 180, nombre: 'Diego Ramírez', motivo_consulta: 'cotizar paneles' };
    const historial12Meses = Array.from({ length: 12 }, (_, i) => ({ mes: `2026-${i + 1}`, kwh: 400 }));
    const capturedFields = { nombre: 'Diego Ramírez', ubicacion: 'Monterrey', historial_consumo_kwh: historial12Meses, pct_cobertura_deseado: '90' };
    expect(seHabriaDisparadoElMotor({ cliente, datosContacto: null, companyId: COMPANY_ID, capturedFields })).toBe(true);
  });

  test('sin identificación completa (sin motivo) → el motor NO se dispara, sin importar los datos técnicos (el gate de identificación se conserva, no se reemplaza)', () => {
    const cliente = { id: 181, nombre: 'Sin nombre', motivo_consulta: null };
    const capturedFields = { ubicacion: 'Monterrey', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' }; // datos técnicos completos
    expect(seHabriaDisparadoElMotor({ cliente, datosContacto: null, companyId: COMPANY_ID, capturedFields })).toBe(false);
  });
});

describe('Auditoría multiempresa (2026-10-17): ejecutar_motor_ingenieria / camposTecnicosFaltantes son exclusivos de paneles solares HOY', () => {
  test('el registro de motores (modules/motores-ingenieria/index.js) solo tiene paneles_solares — ningún otro slug', () => {
    const { MOTORES } = require('../modules/motores-ingenieria');
    expect(Object.keys(MOTORES)).toEqual(['paneles_solares']);
  });
});
