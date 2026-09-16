'use strict';

const {
  crearSolicitud, listarSolicitudes, responderSolicitud, rechazarSolicitud,
} = require('../modules/knowledge-requests');

function crearBuilder(resultado) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then:   (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resultado) {
  const builder = crearBuilder(resultado);
  return { from: jest.fn(() => builder), _builder: builder };
}

const COMPANY_A = 'company-a-0001';

describe('knowledge-requests', () => {
  describe('crearSolicitud()', () => {
    test('inserta con company_id, question recortada y employee_id', async () => {
      const fila = { id: 1, company_id: COMPANY_A, question: '¿cómo funciona X?', answer_status: 'pendiente' };
      const db = crearMockDb({ data: fila, error: null });

      const resultado = await crearSolicitud(db, COMPANY_A, { question: '  ¿cómo funciona X?  ', category: 'FAQ_X', employee_id: 'user-1' });

      expect(db.from).toHaveBeenCalledWith('knowledge_requests');
      expect(db._builder.insert).toHaveBeenCalledWith(expect.objectContaining({
        company_id: COMPANY_A, question: '¿cómo funciona X?', category: 'FAQ_X', employee_id: 'user-1',
      }));
      expect(resultado).toEqual(fila);
    });

    test('sin question: lanza sin llegar a la DB', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(crearSolicitud(db, COMPANY_A, { question: '   ' })).rejects.toThrow('question requerida');
      expect(db.from).not.toHaveBeenCalled();
    });

    test('sin category/employee_id/source_needed: quedan null, no undefined', async () => {
      const db = crearMockDb({ data: {}, error: null });
      await crearSolicitud(db, COMPANY_A, { question: 'algo' });
      expect(db._builder.insert).toHaveBeenCalledWith(expect.objectContaining({
        category: null, employee_id: null, source_needed: null,
      }));
    });

    test('error de DB: lanza con el mensaje real', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo db' } });
      await expect(crearSolicitud(db, COMPANY_A, { question: 'algo' })).rejects.toThrow('fallo db');
    });
  });

  describe('listarSolicitudes()', () => {
    test('sin estado: lista todas ordenadas por created_at desc', async () => {
      const filas = [{ id: 1 }, { id: 2 }];
      const db = crearMockDb({ data: filas, error: null });

      const resultado = await listarSolicitudes(db, COMPANY_A);

      expect(db._builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
      expect(db._builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(resultado).toEqual(filas);
    });

    test('con estado: agrega el filtro answer_status', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarSolicitudes(db, COMPANY_A, 'pendiente');
      expect(db._builder.eq).toHaveBeenCalledWith('answer_status', 'pendiente');
    });

    test('sin filas: arreglo vacío, no null', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await listarSolicitudes(db, COMPANY_A);
      expect(resultado).toEqual([]);
    });

    test('error de DB: lanza con el mensaje real', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo db' } });
      await expect(listarSolicitudes(db, COMPANY_A)).rejects.toThrow('fallo db');
    });
  });

  describe('responderSolicitud()', () => {
    test('marca respondida con respuesta_validada, validado_por y validado_en', async () => {
      const fila = { id: 5, answer_status: 'respondida' };
      const db = crearMockDb({ data: fila, error: null });

      const resultado = await responderSolicitud(db, COMPANY_A, 5, { respuesta_validada: '  La respuesta real  ', validado_por: 'user-1' });

      expect(db._builder.update).toHaveBeenCalledWith(expect.objectContaining({
        answer_status: 'respondida', respuesta_validada: 'La respuesta real', validado_por: 'user-1',
      }));
      expect(db._builder.eq).toHaveBeenCalledWith('id', 5);
      expect(db._builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
      expect(resultado).toEqual(fila);
    });

    test('sin respuesta_validada: lanza sin llegar a la DB', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(responderSolicitud(db, COMPANY_A, 5, { respuesta_validada: '  ' })).rejects.toThrow('respuesta_validada requerida');
      expect(db.from).not.toHaveBeenCalled();
    });

    test('solicitud no encontrada (maybeSingle → null, sin error): lanza explícito', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(responderSolicitud(db, COMPANY_A, 999, { respuesta_validada: 'x' })).rejects.toThrow('no encontrada');
    });

    test('company_id equivocado no puede responder una solicitud de otra empresa (misma ruta: no encontrada)', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(responderSolicitud(db, 'otra-empresa', 5, { respuesta_validada: 'x' })).rejects.toThrow('no encontrada');
      expect(db._builder.eq).toHaveBeenCalledWith('company_id', 'otra-empresa');
    });
  });

  describe('rechazarSolicitud()', () => {
    test('marca rechazada con razón opcional', async () => {
      const fila = { id: 6, answer_status: 'rechazada' };
      const db = crearMockDb({ data: fila, error: null });

      const resultado = await rechazarSolicitud(db, COMPANY_A, 6, { razon: 'ya existe en el catálogo', validado_por: 'user-1' });

      expect(db._builder.update).toHaveBeenCalledWith(expect.objectContaining({
        answer_status: 'rechazada', respuesta_validada: 'ya existe en el catálogo', validado_por: 'user-1',
      }));
      expect(resultado).toEqual(fila);
    });

    test('sin razón: respuesta_validada queda null, no falla', async () => {
      const db = crearMockDb({ data: { id: 6 }, error: null });
      await rechazarSolicitud(db, COMPANY_A, 6, {});
      expect(db._builder.update).toHaveBeenCalledWith(expect.objectContaining({ respuesta_validada: null }));
    });

    test('solicitud no encontrada: lanza explícito', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(rechazarSolicitud(db, COMPANY_A, 999, {})).rejects.toThrow('no encontrada');
    });
  });
});
