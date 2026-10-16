'use strict';

const { actualizarIdentificacionAutomatica, resolverEstadoIdentificacion, ORDEN_CONFIANZA } = require('../modules/identificacion-contacto');

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
});
