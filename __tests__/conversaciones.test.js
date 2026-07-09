'use strict';

const {
  listarConversaciones,
  obtenerHistorial,
  tomarConversacion,
  regresarATara,
  enviarMensajeHumano,
  registrarMensajeEntranteHumano,
} = require('../modules/conversaciones');

// ─── Mock Builder ─────────────────────────────────────────────────────────────
// Mismo patrón thenable de scheduling-engine.test.js/dashboard.test.js.

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    or:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      llamadas.push(tabla);
      return crearBuilder(resultados[idx++] ?? { data: null, error: null });
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ASESOR_1  = 'ases0001-0000-0000-0000-000000000001';
const CLIENTE_ID = 42;

describe('conversaciones', () => {
  describe('listarConversaciones()', () => {
    test('gerencial (owner) ve todos los clientes de la empresa sin filtro .or()', async () => {
      const db = crearMockDb(
        { data: [{ id: CLIENTE_ID, nombre: 'Juan', telefono: '+52...', atendido_por: 'ia', asesor_id: null }], error: null },
        { data: { mensaje_cliente: 'hola', respuesta_tara: 'hola, en qué ayudo', created_at: '2026-07-09T10:00:00Z' }, error: null },
        { data: null, error: null },
      );

      const resultado = await listarConversaciones(db, COMPANY_A, { id: 'u1', rol: 'owner' });

      expect(resultado).toHaveLength(1);
      expect(resultado[0].ultimoMensaje.texto).toBe('hola, en qué ayudo');
    });

    test('asesor ve solo sus conversaciones + el pool sin tomar (usa .or())', async () => {
      const db = crearMockDb(
        { data: [], error: null },
      );

      await listarConversaciones(db, COMPANY_A, { id: ASESOR_1, rol: 'asesor' });

      const builder = db.from.mock.results[0].value;
      expect(builder.or).toHaveBeenCalledWith(
        `asesor_id.eq.${ASESOR_1},and(atendido_por.eq.ia,asesor_id.is.null)`
      );
    });

    test('ordena por mensaje más reciente primero', async () => {
      const db = crearMockDb(
        { data: [
            { id: 1, nombre: 'A', telefono: 'x', atendido_por: 'ia', asesor_id: null },
            { id: 2, nombre: 'B', telefono: 'y', atendido_por: 'ia', asesor_id: null },
          ], error: null },
        // cliente 1: conv + hum
        { data: { mensaje_cliente: 'm', respuesta_tara: 'r', created_at: '2026-07-09T08:00:00Z' }, error: null },
        { data: null, error: null },
        // cliente 2: conv + hum (más reciente)
        { data: { mensaje_cliente: 'm2', respuesta_tara: 'r2', created_at: '2026-07-09T12:00:00Z' }, error: null },
        { data: null, error: null },
      );

      const resultado = await listarConversaciones(db, COMPANY_A, { id: 'u1', rol: 'owner' });
      expect(resultado[0].id).toBe(2);
      expect(resultado[1].id).toBe(1);
    });
  });

  describe('obtenerHistorial()', () => {
    test('combina conversaciones (cliente+tara) y mensajes_humanos, ordenado cronológicamente', async () => {
      const db = crearMockDb(
        { data: [
            { mensaje_cliente: 'hola', respuesta_tara: 'hola! en qué ayudo', created_at: '2026-07-09T10:00:00Z' },
          ], error: null },
        { data: [
            { direccion: 'entrante', contenido: 'necesito hablar con alguien', created_at: '2026-07-09T10:05:00Z' },
            { direccion: 'saliente', contenido: 'claro, dime', created_at: '2026-07-09T10:06:00Z' },
          ], error: null },
      );

      const historial = await obtenerHistorial(db, COMPANY_A, CLIENTE_ID);

      expect(historial).toEqual([
        { de: 'cliente', texto: 'hola', created_at: '2026-07-09T10:00:00Z' },
        { de: 'tara',    texto: 'hola! en qué ayudo', created_at: '2026-07-09T10:00:00Z' },
        { de: 'cliente', texto: 'necesito hablar con alguien', created_at: '2026-07-09T10:05:00Z' },
        { de: 'humano',  texto: 'claro, dime', created_at: '2026-07-09T10:06:00Z' },
      ]);
    });
  });

  describe('tomarConversacion()', () => {
    test('éxito: actualiza atendido_por y asesor_id', async () => {
      const db = crearMockDb(
        { data: { id: CLIENTE_ID, atendido_por: 'humano', asesor_id: ASESOR_1 }, error: null },
      );

      const resultado = await tomarConversacion(db, COMPANY_A, CLIENTE_ID, ASESOR_1);
      expect(resultado.atendido_por).toBe('humano');
    });

    test('409 si ya fue tomada por alguien más (0 filas afectadas)', async () => {
      const db = crearMockDb({ data: null, error: null });

      await expect(tomarConversacion(db, COMPANY_A, CLIENTE_ID, ASESOR_1))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  describe('regresarATara()', () => {
    test('limpia atendido_por y asesor_id', async () => {
      const db = crearMockDb(
        { data: { id: CLIENTE_ID, atendido_por: 'ia', asesor_id: null }, error: null },
      );
      const resultado = await regresarATara(db, COMPANY_A, CLIENTE_ID);
      expect(resultado.atendido_por).toBe('ia');
    });
  });

  describe('enviarMensajeHumano()', () => {
    test('inserta el mensaje y llama sendProactive con el teléfono del cliente', async () => {
      const db = crearMockDb(
        { data: { telefono: '+5218110000000', atendido_por: 'humano' }, error: null },
        { data: null, error: null }, // insert
      );
      const adapter = { sendProactive: jest.fn().mockResolvedValue(undefined) };

      await enviarMensajeHumano(db, adapter, COMPANY_A, CLIENTE_ID, ASESOR_1, 'hola, soy Ana');

      expect(adapter.sendProactive).toHaveBeenCalledWith('hola, soy Ana', '+5218110000000');
    });

    test('rechaza si la conversación no está tomada (atendido_por=ia)', async () => {
      const db = crearMockDb({ data: { telefono: '+52...', atendido_por: 'ia' }, error: null });
      const adapter = { sendProactive: jest.fn() };

      await expect(enviarMensajeHumano(db, adapter, COMPANY_A, CLIENTE_ID, ASESOR_1, 'hola'))
        .rejects.toMatchObject({ status: 409 });
      expect(adapter.sendProactive).not.toHaveBeenCalled();
    });
  });

  describe('registrarMensajeEntranteHumano()', () => {
    test('inserta el mensaje entrante sin asesor_id', async () => {
      const db = crearMockDb({ data: null, error: null });
      await registrarMensajeEntranteHumano(db, COMPANY_A, CLIENTE_ID, 'hola, sigo aquí');

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([{
        cliente_id: CLIENTE_ID,
        company_id: COMPANY_A,
        asesor_id:  null,
        direccion:  'entrante',
        contenido:  'hola, sigo aquí',
      }]);
    });
  });
});
