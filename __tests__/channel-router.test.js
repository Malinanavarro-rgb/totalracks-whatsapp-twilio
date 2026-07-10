'use strict';

const { ChannelRouter } = require('../modules/channel-router');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('ChannelRouter', () => {
  describe('enrutar()', () => {
    test('resuelve un endpoint activo a company_id/company_slug', async () => {
      const db = crearMockDb({ data: { company_id: COMPANY_A, companies: { slug: 'total-racks' } }, error: null });
      const router = new ChannelRouter(db);

      const resultado = await router.enrutar('whatsapp:+14155238886');
      expect(resultado).toEqual({ company_id: COMPANY_A, company_slug: 'total-racks' });
    });

    test('devuelve null si el endpoint no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      const router = new ChannelRouter(db);
      expect(await router.enrutar('whatsapp:+10000000000')).toBeNull();
    });

    test('devuelve null sin consultar la DB si el endpoint es null/vacío', async () => {
      const db = crearMockDb();
      const router = new ChannelRouter(db);
      expect(await router.enrutar(null)).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('usa caché en la segunda llamada al mismo endpoint', async () => {
      const db = crearMockDb({ data: { company_id: COMPANY_A, companies: { slug: 'total-racks' } }, error: null });
      const router = new ChannelRouter(db);

      await router.enrutar('whatsapp:+14155238886');
      await router.enrutar('whatsapp:+14155238886');

      expect(db.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolverEndpointDeEmpresa()', () => {
    test('devuelve el número sin el prefijo del canal', async () => {
      const db = crearMockDb({ data: { endpoint: 'whatsapp:+5218100000000' }, error: null });
      const router = new ChannelRouter(db);

      const numero = await router.resolverEndpointDeEmpresa(COMPANY_A);
      expect(numero).toBe('+5218100000000');
    });

    test('devuelve null si la empresa no tiene canal activo de ese tipo', async () => {
      const db = crearMockDb({ data: null, error: null });
      const router = new ChannelRouter(db);
      expect(await router.resolverEndpointDeEmpresa(COMPANY_A)).toBeNull();
    });

    test('devuelve null sin consultar la DB si company_id es null', async () => {
      const db = crearMockDb();
      const router = new ChannelRouter(db);
      expect(await router.resolverEndpointDeEmpresa(null)).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('usa caché en la segunda llamada a la misma empresa', async () => {
      const db = crearMockDb({ data: { endpoint: 'whatsapp:+5218100000000' }, error: null });
      const router = new ChannelRouter(db);

      await router.resolverEndpointDeEmpresa(COMPANY_A);
      await router.resolverEndpointDeEmpresa(COMPANY_A);

      expect(db.from).toHaveBeenCalledTimes(1);
    });

    test('cachés de enrutar() y resolverEndpointDeEmpresa() no colisionan entre sí', async () => {
      const db = crearMockDb(
        { data: { company_id: COMPANY_A, companies: { slug: 'total-racks' } }, error: null },
        { data: { endpoint: 'whatsapp:+5218100000000' }, error: null },
      );
      const router = new ChannelRouter(db);

      await router.enrutar('whatsapp:+5218100000000');
      const numero = await router.resolverEndpointDeEmpresa(COMPANY_A);

      expect(numero).toBe('+5218100000000');
      expect(db.from).toHaveBeenCalledTimes(2);
    });
  });
});
