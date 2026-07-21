'use strict';

const { resolverOCrearHilo, registrarMensaje, listarHilos, listarMensajesDeHilo, actualizarHilo } = require('../modules/inbox');

function crearBuilder(resultado, llamadas) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn((...a) => { llamadas.push(['update', ...a]); return builder; }),
    eq:     jest.fn((...a) => { llamadas.push(['eq', ...a]); return builder; }),
    or:     jest.fn((...a) => { llamadas.push(['or', ...a]); return builder; }),
    lt:     jest.fn((...a) => { llamadas.push(['lt', ...a]); return builder; }),
    contains: jest.fn((...a) => { llamadas.push(['contains', ...a]); return builder; }),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockResolvedValue(resultado),
    single: jest.fn().mockResolvedValue(resultado),
    then:   (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resolvers) {
  const llamadas = {};
  const db = {
    from: jest.fn((tabla) => {
      llamadas[tabla] = llamadas[tabla] || [];
      const resultado = resolvers[tabla] ? resolvers[tabla]() : { data: null, error: null };
      return crearBuilder(resultado, llamadas[tabla]);
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'company-a-0001';
const CLIENTE_1 = 1;

describe('inbox', () => {
  describe('resolverOCrearHilo()', () => {
    test('hilo abierto ya existe: lo regresa sin crear otro', async () => {
      const db = crearMockDb({ hilos: () => ({ data: [{ id: 'hilo-1', estado: 'abierta' }], error: null }) });
      const hilo = await resolverOCrearHilo(db, { company_id: COMPANY_A, cliente_id: CLIENTE_1, canal: 'whatsapp', proveedor: 'meta' });
      expect(hilo).toEqual({ id: 'hilo-1', estado: 'abierta' });
    });

    test('sin hilo abierto: crea uno nuevo', async () => {
      let llamada = 0;
      const db = crearMockDb({
        hilos: () => (llamada++ === 0 ? { data: [], error: null } : { data: { id: 'hilo-nuevo' }, error: null }),
      });
      const hilo = await resolverOCrearHilo(db, { company_id: COMPANY_A, cliente_id: CLIENTE_1, canal: 'whatsapp', proveedor: 'meta' });
      expect(hilo).toEqual({ id: 'hilo-nuevo' });
    });

    test('lanza si falla la búsqueda', async () => {
      const db = crearMockDb({ hilos: () => ({ data: null, error: { message: 'boom' } }) });
      await expect(resolverOCrearHilo(db, { company_id: COMPANY_A, cliente_id: CLIENTE_1, canal: 'whatsapp', proveedor: 'meta' })).rejects.toThrow('boom');
    });
  });

  describe('registrarMensaje()', () => {
    test('inserta el mensaje y refresca el preview del hilo', async () => {
      const db = crearMockDb({
        mensajes: () => ({ data: { id: 'msg-1' }, error: null }),
        hilos:    () => ({ data: {}, error: null }),
      });

      const mensaje = await registrarMensaje(db, {
        hilo_id: 'hilo-1', company_id: COMPANY_A, direccion: 'entrante', remitente_tipo: 'cliente', contenido: 'Hola, quiero información',
      });

      expect(mensaje).toEqual({ id: 'msg-1' });
      const llamadaUpdate = db._llamadas.hilos.find(l => l[0] === 'update');
      expect(llamadaUpdate[1]).toEqual(expect.objectContaining({ ultimo_mensaje_preview: 'Hola, quiero información' }));
    });

    test('preview usa [tipo_contenido] cuando no hay texto (ej. imagen)', async () => {
      const db = crearMockDb({ mensajes: () => ({ data: { id: 'msg-2' }, error: null }), hilos: () => ({ data: {}, error: null }) });
      await registrarMensaje(db, { hilo_id: 'hilo-1', company_id: COMPANY_A, direccion: 'entrante', remitente_tipo: 'cliente', tipo_contenido: 'imagen', adjunto_url: 'https://x/img.jpg' });
      const llamadaUpdate = db._llamadas.hilos.find(l => l[0] === 'update');
      expect(llamadaUpdate[1].ultimo_mensaje_preview).toBe('[imagen]');
    });

    test('lanza si falla el insert del mensaje', async () => {
      const db = crearMockDb({ mensajes: () => ({ data: null, error: { message: 'fallo insert' } }) });
      await expect(registrarMensaje(db, { hilo_id: 'h', company_id: COMPANY_A, direccion: 'entrante', remitente_tipo: 'cliente', contenido: 'x' }))
        .rejects.toThrow('fallo insert');
    });

    test('no lanza si el insert del mensaje tuvo éxito pero falla el refresco del hilo', async () => {
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'mensajes') return crearBuilder({ data: { id: 'msg-1' }, error: null }, []);
          return crearBuilder({ data: null, error: null }, []); // update de hilos "falla" silenciosamente vía then
        }),
      };
      db.from = jest.fn((tabla) => {
        if (tabla === 'mensajes') {
          const b = crearBuilder({ data: { id: 'msg-1' }, error: null }, []);
          return b;
        }
        // simula que .update(...).eq(...) rechaza
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockRejectedValue(new Error('fallo de red')),
        };
      });
      await expect(registrarMensaje(db, { hilo_id: 'h', company_id: COMPANY_A, direccion: 'entrante', remitente_tipo: 'cliente', contenido: 'x' }))
        .resolves.toEqual({ id: 'msg-1' });
    });
  });

  describe('listarHilos()', () => {
    test('gerencial ve todo, sin filtro adicional de asesor', async () => {
      const db = crearMockDb({ hilos: () => ({ data: [{ id: 'h1' }], error: null }) });
      await listarHilos(db, COMPANY_A, { usuario: { id: 'u1', rol: 'owner' } });
      expect(db._llamadas.hilos.some(l => l[0] === 'or')).toBe(false);
    });

    test('no-gerencial ve solo lo asignado a sí mismo + el pool sin asignar', async () => {
      const db = crearMockDb({ hilos: () => ({ data: [], error: null }) });
      await listarHilos(db, COMPANY_A, { usuario: { id: 'u1', rol: 'asesor' } });
      expect(db._llamadas.hilos).toContainEqual(['or', 'asesor_id.eq.u1,asesor_id.is.null']);
    });

    test('aplica filtros de canal/estado/prioridad/etiqueta/cursor', async () => {
      const db = crearMockDb({ hilos: () => ({ data: [], error: null }) });
      await listarHilos(db, COMPANY_A, { canal: 'whatsapp', estado: 'abierta', prioridad: 'alta', etiqueta: 'vip', cursor: '2026-01-01' });
      expect(db._llamadas.hilos).toContainEqual(['eq', 'canal', 'whatsapp']);
      expect(db._llamadas.hilos).toContainEqual(['eq', 'estado', 'abierta']);
      expect(db._llamadas.hilos).toContainEqual(['eq', 'prioridad', 'alta']);
      expect(db._llamadas.hilos).toContainEqual(['contains', 'etiquetas', ['vip']]);
      expect(db._llamadas.hilos).toContainEqual(['lt', 'ultimo_mensaje_at', '2026-01-01']);
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ hilos: () => ({ data: null, error: { message: 'boom' } }) });
      await expect(listarHilos(db, COMPANY_A)).rejects.toThrow('boom');
    });
  });

  describe('listarMensajesDeHilo()', () => {
    test('regresa los mensajes ordenados cronológicamente', async () => {
      const db = crearMockDb({ mensajes: () => ({ data: [{ id: 'm1' }, { id: 'm2' }], error: null }) });
      expect(await listarMensajesDeHilo(db, 'hilo-1')).toEqual([{ id: 'm1' }, { id: 'm2' }]);
    });
  });

  describe('actualizarHilo()', () => {
    test('solo aplica los campos dados', async () => {
      const db = crearMockDb({ hilos: () => ({ data: { id: 'h1', prioridad: 'alta' }, error: null }) });
      const resultado = await actualizarHilo(db, COMPANY_A, 'h1', { prioridad: 'alta' });
      expect(resultado).toEqual({ id: 'h1', prioridad: 'alta' });
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ hilos: () => ({ data: null, error: { message: 'boom' } }) });
      await expect(actualizarHilo(db, COMPANY_A, 'h1', { estado: 'cerrada' })).rejects.toThrow('boom');
    });
  });
});
