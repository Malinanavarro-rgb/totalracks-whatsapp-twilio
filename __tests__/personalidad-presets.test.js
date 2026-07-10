'use strict';

const { instruccionesDePersonalidad } = require('../modules/personalidad-presets');

describe('personalidad-presets.instruccionesDePersonalidad()', () => {
  test('valores default (normales/moderado/sugerir_productos) no agregan ninguna instrucción', () => {
    const instrucciones = instruccionesDePersonalidad({
      longitud_respuesta: 'normales', uso_emojis: 'moderado', nivel_iniciativa: 'sugerir_productos',
    });
    expect(instrucciones).toEqual([]);
  });

  test('sin personality (undefined), no agrega ninguna instrucción', () => {
    expect(instruccionesDePersonalidad(undefined)).toEqual([]);
  });

  test('longitud=cortas agrega instrucción de brevedad', () => {
    const instrucciones = instruccionesDePersonalidad({ longitud_respuesta: 'cortas' });
    expect(instrucciones).toEqual([expect.stringContaining('breve')]);
  });

  test('longitud=detalladas agrega instrucción de mayor detalle', () => {
    const instrucciones = instruccionesDePersonalidad({ longitud_respuesta: 'detalladas' });
    expect(instrucciones[0]).toContain('completas');
  });

  test('uso_emojis=nunca agrega instrucción de no usar emojis', () => {
    const instrucciones = instruccionesDePersonalidad({ uso_emojis: 'nunca' });
    expect(instrucciones).toEqual([expect.stringContaining('No uses emojis')]);
  });

  test('uso_emojis=frecuente agrega instrucción de usar emojis seguido', () => {
    const instrucciones = instruccionesDePersonalidad({ uso_emojis: 'frecuente' });
    expect(instrucciones[0]).toContain('frecuencia');
  });

  test('nivel_iniciativa=solo_responder restringe a solo responder', () => {
    const instrucciones = instruccionesDePersonalidad({ nivel_iniciativa: 'solo_responder' });
    expect(instrucciones[0]).toContain('Limítate a responder');
  });

  test('nivel_iniciativa=cerrar_ventas agrega instrucción de cierre proactivo', () => {
    const instrucciones = instruccionesDePersonalidad({ nivel_iniciativa: 'cerrar_ventas' });
    expect(instrucciones[0]).toContain('cerrar la venta');
  });

  test('combina las 3 instrucciones cuando las 3 son no-default', () => {
    const instrucciones = instruccionesDePersonalidad({
      longitud_respuesta: 'cortas', uso_emojis: 'frecuente', nivel_iniciativa: 'cerrar_ventas',
    });
    expect(instrucciones).toHaveLength(3);
  });
});
