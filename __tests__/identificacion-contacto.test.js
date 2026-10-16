'use strict';

const {
  actualizarIdentificacionAutomatica, resolverEstadoIdentificacion, ORDEN_CONFIANZA,
  puedeEjecutarseAccionComercial, ACCIONES_REQUIEREN_IDENTIFICACION,
} = require('../modules/identificacion-contacto');

function crearMockDb({ filaCliente, resultadoUpdate = { error: null } } = {}) {
  const eqCalls = [];
  const updateSpy = jest.fn();
  const selectBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((k, v) => { eqCalls.push(['select', k, v]); return selectBuilder; }),
    maybeSingle: jest.fn().mockResolvedValue({ data: filaCliente ?? null, error: null }),
  };
  const updateBuilder = {
    eq: jest.fn((k, v) => { eqCalls.push(['update', k, v]); return updateBuilder; }),
    then: (resolve) => resolve(resultadoUpdate),
  };
  const db = {
    from: jest.fn(() => ({
      ...selectBuilder,
      update: (...args) => { updateSpy(...args); return updateBuilder; },
    })),
    _eqCalls: eqCalls,
    _updateSpy: updateSpy,
  };
  return db;
}

const CLIENTE_ID = 'cliente-1';
const COMPANY_ID = 'company-aaaa';

describe('identificacion-contacto', () => {
  describe('resolverEstadoIdentificacion()', () => {
    test('nombre y motivo presentes → "identificado"', () => {
      expect(resolverEstadoIdentificacion({ nombre: 'Roberto', motivoConsulta: 'Paneles' })).toBe('identificado');
    });
    test('solo nombre → "parcial"', () => {
      expect(resolverEstadoIdentificacion({ nombre: 'Roberto', motivoConsulta: null })).toBe('parcial');
    });
    test('solo motivo → "parcial"', () => {
      expect(resolverEstadoIdentificacion({ nombre: null, motivoConsulta: 'Paneles' })).toBe('parcial');
    });
    test('nombre "Sin nombre" (placeholder) no cuenta como identificado', () => {
      expect(resolverEstadoIdentificacion({ nombre: 'Sin nombre', motivoConsulta: 'Paneles' })).toBe('parcial');
    });
    test('ninguno → "sin_identificar"', () => {
      expect(resolverEstadoIdentificacion({ nombre: null, motivoConsulta: null })).toBe('sin_identificar');
    });
  });

  describe('actualizarIdentificacionAutomatica()', () => {
    test('cliente nuevo sin nombre ni motivo: escribe ambos con fuente "cliente"', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Sin nombre', motivo_consulta: null, motivo_consulta_fuente: null } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'Paneles solares' });

      expect(db._updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        nombre: 'Roberto', motivo_consulta: 'Paneles solares', motivo_consulta_fuente: 'cliente',
      }));
    });

    test('AISLAMIENTO: el UPDATE siempre se filtra por company_id además de clienteId', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Sin nombre', motivo_consulta: null, motivo_consulta_fuente: null } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'Paneles' });

      const filtrosUpdate = db._eqCalls.filter(([fase]) => fase === 'update');
      expect(filtrosUpdate).toContainEqual(['update', 'id', CLIENTE_ID]);
      expect(filtrosUpdate).toContainEqual(['update', 'company_id', COMPANY_ID]);
    });

    test('nunca sobreescribe con valor vacío: si "nombre"/"motivo" vienen null, no toca la fila', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Roberto', motivo_consulta: 'Paneles', motivo_consulta_fuente: 'cliente' } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: null, motivo: null });
      expect(db._updateSpy).not.toHaveBeenCalled();
    });

    test('CRÍTICO: no sobreescribe un motivo "manual" con uno "cliente" de menor confianza', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Roberto', motivo_consulta: 'Corregido por un asesor', motivo_consulta_fuente: 'manual' } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'Otra cosa que dijo el cliente' });

      // El nombre no cambió (mismo valor) y el motivo no se actualiza por ser de menor confianza — sin escritura.
      expect(db._updateSpy).not.toHaveBeenCalled();
    });

    test('corrección de nombre: un valor nuevo y distinto SÍ se escribe, aunque ya hubiera uno', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Roberto', motivo_consulta: 'Paneles', motivo_consulta_fuente: 'cliente' } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto Pérez', motivo: null });

      expect(db._updateSpy).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Roberto Pérez' }));
    });

    test('cambio de motivo: un valor "cliente" nuevo reemplaza a uno "cliente" anterior (misma confianza, se permite el cambio)', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Roberto', motivo_consulta: 'Mantenimiento', motivo_consulta_fuente: 'cliente' } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: null, motivo: 'Instalación nueva' });

      expect(db._updateSpy).toHaveBeenCalledWith(expect.objectContaining({ motivo_consulta: 'Instalación nueva', motivo_consulta_fuente: 'cliente' }));
    });

    test('mismo valor ya guardado: no genera un UPDATE innecesario', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Roberto', motivo_consulta: 'Paneles', motivo_consulta_fuente: 'cliente' } });
      await actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'Paneles' });
      expect(db._updateSpy).not.toHaveBeenCalled();
    });

    test('cliente no encontrado: nunca lanza, no intenta escribir', async () => {
      const db = crearMockDb({ filaCliente: null });
      await expect(actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'x' })).resolves.toBeUndefined();
      expect(db._updateSpy).not.toHaveBeenCalled();
    });

    test('sin clienteId: nunca lanza, nunca consulta', async () => {
      const db = crearMockDb();
      await expect(actualizarIdentificacionAutomatica(db, null, COMPANY_ID, { nombre: 'Roberto', motivo: 'x' })).resolves.toBeUndefined();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('si Supabase falla en el UPDATE, nunca lanza', async () => {
      const db = crearMockDb({ filaCliente: { nombre: 'Sin nombre', motivo_consulta: null, motivo_consulta_fuente: null }, resultadoUpdate: { error: { message: 'timeout' } } });
      await expect(actualizarIdentificacionAutomatica(db, CLIENTE_ID, COMPANY_ID, { nombre: 'Roberto', motivo: 'Paneles' })).resolves.toBeUndefined();
    });
  });

  describe('ORDEN_CONFIANZA', () => {
    test('manual > cliente > ia_inferido', () => {
      expect(ORDEN_CONFIANZA.manual).toBeGreaterThan(ORDEN_CONFIANZA.cliente);
      expect(ORDEN_CONFIANZA.cliente).toBeGreaterThan(ORDEN_CONFIANZA.ia_inferido);
    });
  });

  // PRIORIDAD 3 (incidente cotización 83, 2026-10-16): única función de
  // autorización — los 3 caminos (A, B, C) deben llamar a ESTA, nunca
  // reimplementar el criterio.
  describe('puedeEjecutarseAccionComercial() — única función de autorización', () => {
    test('acción que NO requiere identificación (ej. crear_ticket_soporte): siempre autorizada, sin importar el cliente', () => {
      expect(puedeEjecutarseAccionComercial({ tipoAccion: 'crear_ticket_soporte', companyId: 'c1', clienteId: 1 }))
        .toEqual({ autorizada: true });
    });

    test.each(ACCIONES_REQUIEREN_IDENTIFICACION)('%s con nombre Y motivo: autorizada', (tipoAccion) => {
      const resultado = puedeEjecutarseAccionComercial({ tipoAccion, companyId: 'c1', clienteId: 1, nombre: 'Roberto', motivoConsulta: 'Paneles' });
      expect(resultado.autorizada).toBe(true);
    });

    test.each(ACCIONES_REQUIEREN_IDENTIFICACION)('%s sin nombre ni motivo: rechazada, campoFaltante="nombre"', (tipoAccion) => {
      const resultado = puedeEjecutarseAccionComercial({ tipoAccion, companyId: 'c1', clienteId: 1, nombre: null, motivoConsulta: null });
      expect(resultado).toMatchObject({ autorizada: false, motivo: 'identificacion_incompleta', campoFaltante: 'nombre' });
    });

    test('con nombre pero sin motivo: rechazada, campoFaltante="motivo"', () => {
      const resultado = puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad', companyId: 'c1', clienteId: 1, nombre: 'Roberto', motivoConsulta: null });
      expect(resultado).toMatchObject({ autorizada: false, campoFaltante: 'motivo' });
    });

    test('CRÍTICO: sin companyId o sin clienteId → rechazada, nunca autoriza por falta de contexto', () => {
      expect(puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad', companyId: null, clienteId: 1, nombre: 'Roberto', motivoConsulta: 'x' }))
        .toMatchObject({ autorizada: false, motivo: 'sin_contexto_valido' });
      expect(puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad', companyId: 'c1', clienteId: null, nombre: 'Roberto', motivoConsulta: 'x' }))
        .toMatchObject({ autorizada: false, motivo: 'sin_contexto_valido' });
    });

    test('intento de omitir la validación: nombre="Sin nombre" (placeholder) nunca autoriza, aunque motivoConsulta esté presente', () => {
      const resultado = puedeEjecutarseAccionComercial({ tipoAccion: 'ejecutar_motor_ingenieria', companyId: 'c1', clienteId: 1, nombre: 'Sin nombre', motivoConsulta: 'Paneles' });
      expect(resultado.autorizada).toBe(false);
    });

    test('sin argumentos en absoluto: nunca lanza (tipoAccion undefined no está en la lista gated, autoriza como cualquier acción no-comercial)', () => {
      expect(() => puedeEjecutarseAccionComercial()).not.toThrow();
      expect(puedeEjecutarseAccionComercial()).toEqual({ autorizada: true });
    });

    test('tipoAccion gated pero sin ningún otro dato: nunca lanza, rechaza por falta de contexto', () => {
      expect(() => puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad' })).not.toThrow();
      expect(puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad' }).autorizada).toBe(false);
    });

    test('AISLAMIENTO MULTIEMPRESA: la identificación de un cliente de la empresa A nunca autoriza una acción para la empresa B', () => {
      // "Roberto" está identificado en la empresa A — si por error se evaluara
      // con el company_id de la empresa B, igual debe autorizar (la función
      // no consulta la base de datos por su cuenta, así que esto prueba que
      // el CALLER es responsable de pasar nombre/motivoConsulta ya resueltos
      // específicamente para esa empresa — no hay forma de que la función
      // "filtre mal" porque no tiene acceso a otra fuente de datos).
      const paraEmpresaA = puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad', companyId: 'empresa-A', clienteId: 1, nombre: 'Roberto', motivoConsulta: 'Paneles' });
      const paraEmpresaB = puedeEjecutarseAccionComercial({ tipoAccion: 'crear_oportunidad', companyId: 'empresa-B', clienteId: 1, nombre: null, motivoConsulta: null });
      expect(paraEmpresaA.autorizada).toBe(true);
      expect(paraEmpresaB.autorizada).toBe(false); // mismo clienteId, pero sin datos de identificación para esta llamada → nunca hereda los de A
    });
  });
});
