'use strict';

const { calcularCambiosNombreEmpresa } = require('../modules/nombre-cliente');

describe('nombre-cliente', () => {
  describe('calcularCambiosNombreEmpresa()', () => {
    test('cliente nuevo (nombre "Sin nombre") + IA extrajo nombre → lo guarda', () => {
      const cliente = { nombre: 'Sin nombre', empresa: null };
      const cambios = calcularCambiosNombreEmpresa(cliente, { nombre: 'Alina' });
      expect(cambios).toEqual({ nombre: 'Alina' });
    });

    test('cliente sin nombre (null) + IA extrajo nombre → lo guarda', () => {
      const cliente = { nombre: null, empresa: null };
      const cambios = calcularCambiosNombreEmpresa(cliente, { nombre: 'Alina' });
      expect(cambios).toEqual({ nombre: 'Alina' });
    });

    test('cliente ya tiene nombre real + IA "extrajo" otro nombre → NO lo pisa (una sola vez)', () => {
      const cliente = { nombre: 'Alina', empresa: null };
      const cambios = calcularCambiosNombreEmpresa(cliente, { nombre: 'Otra persona' });
      expect(cambios).toEqual({});
    });

    test('IA no extrajo nombre este turno → no hay cambio de nombre', () => {
      const cliente = { nombre: 'Sin nombre', empresa: null };
      const cambios = calcularCambiosNombreEmpresa(cliente, { nombre: null });
      expect(cambios).toEqual({});
    });

    test('guarda nombre y empresa en el mismo turno si ambos vienen nuevos', () => {
      const cliente = { nombre: 'Sin nombre', empresa: null };
      const cambios = calcularCambiosNombreEmpresa(cliente, { nombre: 'Alina', empresa: 'Uprise' });
      expect(cambios).toEqual({ nombre: 'Alina', empresa: 'Uprise' });
    });

    test('empresa ya guardada → no la pisa aunque la IA extraiga otra', () => {
      const cliente = { nombre: 'Alina', empresa: 'Uprise' };
      const cambios = calcularCambiosNombreEmpresa(cliente, { empresa: 'Otra empresa' });
      expect(cambios).toEqual({});
    });

    test('datosExtraidos vacío/undefined → sin cambios, no lanza', () => {
      const cliente = { nombre: 'Sin nombre', empresa: null };
      expect(calcularCambiosNombreEmpresa(cliente, {})).toEqual({});
      expect(calcularCambiosNombreEmpresa(cliente, undefined)).toEqual({});
    });

    test('cliente undefined (defensivo) → no lanza, sin cambios', () => {
      expect(calcularCambiosNombreEmpresa(undefined, { nombre: 'Alina' })).toEqual({ nombre: 'Alina' });
    });
  });
});
