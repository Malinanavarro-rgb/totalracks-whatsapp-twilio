'use strict';

const { ROLES_GERENCIALES, esGerencial } = require('../modules/permisos');

describe('permisos', () => {
  test('ROLES_GERENCIALES es exactamente owner/administrador/supervisor', () => {
    expect(ROLES_GERENCIALES).toEqual(['owner', 'administrador', 'supervisor']);
  });

  describe('esGerencial()', () => {
    test.each(['owner', 'administrador', 'supervisor'])('%s es gerencial', (rol) => {
      expect(esGerencial(rol)).toBe(true);
    });

    test('asesor no es gerencial', () => {
      expect(esGerencial('asesor')).toBe(false);
    });

    test('rol desconocido no es gerencial', () => {
      expect(esGerencial('inexistente')).toBe(false);
    });
  });
});
