'use strict';

const { ActionRunner } = require('../modules/action-runner');

describe('ActionRunner', () => {
  describe('registrar() + ejecutar()', () => {
    test('despacha al handler registrado con (parametros, ctx)', async () => {
      const runner  = new ActionRunner();
      const handler = jest.fn().mockResolvedValue({ id: 'creado-1' });
      runner.registrar('crear_oportunidad', handler);

      const ctx = { company_id: 'c-1' };
      const resultado = await runner.ejecutar({ tipo: 'crear_oportunidad', parametros: { foo: 'bar' } }, ctx);

      expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, ctx);
      expect(resultado).toEqual({ id: 'creado-1' });
    });

    test('despacha cada tipo registrado a su propio handler', async () => {
      const runner = new ActionRunner();
      const handlerA = jest.fn().mockResolvedValue('A');
      const handlerB = jest.fn().mockResolvedValue('B');
      runner.registrar('tipo_a', handlerA);
      runner.registrar('tipo_b', handlerB);

      await runner.ejecutar({ tipo: 'tipo_a', parametros: {} }, {});
      await runner.ejecutar({ tipo: 'tipo_b', parametros: {} }, {});

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });

    test('devuelve un error legible (sin lanzar) cuando el tipo no está registrado', async () => {
      const runner = new ActionRunner();

      const resultado = await runner.ejecutar({ tipo: 'accion_inexistente', parametros: {} }, {});

      expect(resultado).toEqual({ error: 'Acción desconocida: accion_inexistente' });
    });

    test('propaga el error del handler si este lanza (no lo silencia)', async () => {
      const runner = new ActionRunner();
      runner.registrar('falla', jest.fn().mockRejectedValue(new Error('boom')));

      await expect(runner.ejecutar({ tipo: 'falla', parametros: {} }, {})).rejects.toThrow('boom');
    });

    test('registrar() dos veces para el mismo tipo reemplaza el handler anterior', async () => {
      const runner = new ActionRunner();
      const handlerViejo = jest.fn().mockResolvedValue('viejo');
      const handlerNuevo = jest.fn().mockResolvedValue('nuevo');
      runner.registrar('tipo_x', handlerViejo);
      runner.registrar('tipo_x', handlerNuevo);

      const resultado = await runner.ejecutar({ tipo: 'tipo_x', parametros: {} }, {});

      expect(handlerViejo).not.toHaveBeenCalled();
      expect(resultado).toBe('nuevo');
    });
  });
});
