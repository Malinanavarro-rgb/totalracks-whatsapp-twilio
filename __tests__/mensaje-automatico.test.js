'use strict';

const { renderizarPlantilla } = require('../modules/mensaje-automatico');

describe('mensaje-automatico', () => {
  describe('renderizarPlantilla()', () => {
    test('sustituye una variable simple', () => {
      const resultado = renderizarPlantilla('Hola {{nombre}}!', { nombre: 'Carlos' });
      expect(resultado).toBe('Hola Carlos!');
    });

    test('sustituye varias variables distintas', () => {
      const resultado = renderizarPlantilla(
        'Cita con {{asesor}} el {{fecha}} a las {{hora}}',
        { asesor: 'Ana', fecha: '10 de julio', hora: '10:00am' }
      );
      expect(resultado).toBe('Cita con Ana el 10 de julio a las 10:00am');
    });

    test('variable repetida se sustituye en todas sus apariciones', () => {
      const resultado = renderizarPlantilla('{{nombre}}, {{nombre}}!', { nombre: 'Luis' });
      expect(resultado).toBe('Luis, Luis!');
    });

    test('variable faltante se reemplaza por cadena vacía, no queda "{{...}}" literal', () => {
      const resultado = renderizarPlantilla('Hola {{nombre}}, tu cita es con {{asesor}}', { nombre: 'Carlos' });
      expect(resultado).toBe('Hola Carlos, tu cita es con ');
      expect(resultado).not.toContain('{{');
    });

    test('plantilla sin variables se devuelve igual', () => {
      const resultado = renderizarPlantilla('Mensaje fijo sin variables.', { nombre: 'Carlos' });
      expect(resultado).toBe('Mensaje fijo sin variables.');
    });

    test('sin variables provistas, todas se vuelven cadena vacía', () => {
      const resultado = renderizarPlantilla('Hola {{nombre}}!');
      expect(resultado).toBe('Hola !');
    });
  });
});
