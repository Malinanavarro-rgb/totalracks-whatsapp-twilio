'use strict';

const {
  obtenerSuscripcionVigente, sincronizarEstadoOperativo, crearSuscripcionManual,
  suspenderOrganizacion, reactivarOrganizacion, extenderPrueba, regalarMeses, cambiarPlan,
  crearCheckoutSession, crearPortalSession, manejarWebhookStripe,
} = require('../modules/plataforma-billing');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => { llamadas.push(tabla); return crearBuilder(resultados[idx++] ?? { data: null, error: null }); }),
    _llamadas: llamadas,
  };
  return db;
}

const ORG_ID = 'org-1';

describe('plataforma-billing', () => {
  describe('obtenerSuscripcionVigente()', () => {
    test('devuelve la suscripción más reciente con su plan embebido', async () => {
      const suscripcion = { id: 'sub-1', estado: 'active', planes: { clave: 'pro' } };
      const db = crearMockDb({ data: suscripcion, error: null });
      const resultado = await obtenerSuscripcionVigente(db, ORG_ID);
      expect(resultado).toEqual(suscripcion);
    });

    test('null si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      expect(await obtenerSuscripcionVigente(db, ORG_ID)).toBeNull();
    });
  });

  describe('sincronizarEstadoOperativo()', () => {
    test('organization activa → companies.estado = activo', async () => {
      const db = crearMockDb(
        { data: { estado: 'activa' }, error: null },
        { data: null, error: null }
      );
      await sincronizarEstadoOperativo(db, ORG_ID);
      const builderCompanies = db.from.mock.results[1].value;
      expect(builderCompanies.update).toHaveBeenCalledWith({ estado: 'activo' });
    });

    test('organization suspendida → companies.estado = suspendido', async () => {
      const db = crearMockDb(
        { data: { estado: 'suspendida' }, error: null },
        { data: null, error: null }
      );
      await sincronizarEstadoOperativo(db, ORG_ID);
      const builderCompanies = db.from.mock.results[1].value;
      expect(builderCompanies.update).toHaveBeenCalledWith({ estado: 'suspendido' });
    });

    test('lanza si la organization no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(sincronizarEstadoOperativo(db, 'org-inexistente')).rejects.toThrow(/no encontrada/);
    });
  });

  describe('crearSuscripcionManual()', () => {
    test('crea la suscripción, marca la organization activa y sincroniza companies.estado', async () => {
      const db = crearMockDb(
        { data: { id: 'sub-1', organization_id: ORG_ID, plan_id: 'plan-1' }, error: null }, // insert suscripciones
        { data: null, error: null }, // update organizations.estado = activa
        { data: { estado: 'activa' }, error: null }, // sincronizarEstadoOperativo: select organizations
        { data: null, error: null }  // sincronizarEstadoOperativo: update companies
      );

      const resultado = await crearSuscripcionManual(db, { organizationId: ORG_ID, planId: 'plan-1', mesesRegalo: 2 });

      expect(resultado.id).toBe('sub-1');
      expect(db._llamadas).toEqual(['suscripciones', 'organizations', 'organizations', 'companies']);
    });

    test('lanza si el INSERT falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'plan inexistente' } });
      await expect(crearSuscripcionManual(db, { organizationId: ORG_ID, planId: 'plan-x' })).rejects.toThrow(/plan inexistente/);
    });
  });

  describe('suspenderOrganizacion() / reactivarOrganizacion()', () => {
    test('suspenderOrganizacion pone estado=suspendida y sincroniza', async () => {
      const db = crearMockDb(
        { data: null, error: null }, // update organizations
        { data: { estado: 'suspendida' }, error: null }, // select organizations (sincronizar)
        { data: null, error: null } // update companies
      );
      await suspenderOrganizacion(db, ORG_ID);
      expect(db.from.mock.results[0].value.update).toHaveBeenCalledWith({ estado: 'suspendida' });
    });

    test('reactivarOrganizacion pone estado=activa y sincroniza', async () => {
      const db = crearMockDb(
        { data: null, error: null },
        { data: { estado: 'activa' }, error: null },
        { data: null, error: null }
      );
      await reactivarOrganizacion(db, ORG_ID);
      expect(db.from.mock.results[0].value.update).toHaveBeenCalledWith({ estado: 'activa' });
    });
  });

  describe('extenderPrueba()', () => {
    test('suma días a partir de fecha_prueba_fin existente', async () => {
      const db = crearMockDb(
        { data: { fecha_prueba_fin: '2026-08-01T00:00:00.000Z' }, error: null },
        { data: { id: 'sub-1', fecha_prueba_fin: '2026-08-08T00:00:00.000Z' }, error: null }
      );
      const resultado = await extenderPrueba(db, 'sub-1', 7);
      expect(resultado.fecha_prueba_fin).toBe('2026-08-08T00:00:00.000Z');
    });

    test('lanza si la suscripción no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(extenderPrueba(db, 'sub-x', 7)).rejects.toThrow(/no encontrada/);
    });
  });

  describe('regalarMeses()', () => {
    test('acumula meses_regalo y extiende fecha_periodo_actual_fin', async () => {
      const db = crearMockDb(
        { data: { meses_regalo: 1, fecha_periodo_actual_fin: null }, error: null },
        { data: { id: 'sub-1', meses_regalo: 3 }, error: null }
      );
      const resultado = await regalarMeses(db, 'sub-1', 2);
      expect(resultado.meses_regalo).toBe(3);
    });
  });

  describe('cambiarPlan()', () => {
    test('actualiza plan_id', async () => {
      const db = crearMockDb({ data: { id: 'sub-1', plan_id: 'plan-2' }, error: null });
      const resultado = await cambiarPlan(db, 'sub-1', 'plan-2');
      expect(resultado.plan_id).toBe('plan-2');
    });
  });

  describe('crearCheckoutSession() / crearPortalSession()', () => {
    test('crearCheckoutSession lanza 501 si stripe es null (no configurado)', async () => {
      await expect(
        crearCheckoutSession(null, { organizationId: ORG_ID, plan: { stripe_price_id: 'price_1' } })
      ).rejects.toMatchObject({ status: 501 });
    });

    test('crearCheckoutSession lanza 400 si el plan no tiene stripe_price_id', async () => {
      const stripe = { checkout: { sessions: { create: jest.fn() } } };
      await expect(
        crearCheckoutSession(stripe, { organizationId: ORG_ID, plan: { clave: 'starter', stripe_price_id: null } })
      ).rejects.toMatchObject({ status: 400 });
    });

    test('crearCheckoutSession éxito: llama a Stripe con client_reference_id', async () => {
      const stripe = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/checkout' }) } } };
      const session = await crearCheckoutSession(stripe, {
        organizationId: ORG_ID, plan: { clave: 'pro', stripe_price_id: 'price_1' },
        urlExito: 'https://app/exito', urlCancelacion: 'https://app/cancel',
      });
      expect(session.url).toBe('https://stripe.test/checkout');
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ client_reference_id: ORG_ID }));
    });

    test('crearPortalSession lanza 501 si stripe es null', async () => {
      await expect(crearPortalSession(null, { stripeCustomerId: 'cus_1' })).rejects.toMatchObject({ status: 501 });
    });

    test('crearPortalSession éxito', async () => {
      const stripe = { billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/portal' } ) } } };
      const session = await crearPortalSession(stripe, { stripeCustomerId: 'cus_1', urlRetorno: 'https://app/config' });
      expect(session.url).toBe('https://stripe.test/portal');
    });
  });

  describe('manejarWebhookStripe()', () => {
    test('customer.subscription.updated con organization_id: upsert suscripciones + sincroniza estado', async () => {
      const db = crearMockDb(
        { data: null, error: null }, // upsert suscripciones
        { data: null, error: null }, // update organizations.estado
        { data: { estado: 'activa' }, error: null }, // sincronizar: select organizations
        { data: null, error: null }  // sincronizar: update companies
      );
      const evento = {
        type: 'customer.subscription.updated',
        data: { object: {
          id: 'sub_stripe_1', customer: 'cus_1', status: 'active',
          current_period_start: 1753142400, current_period_end: 1755820800,
          cancel_at_period_end: false, metadata: { organization_id: ORG_ID, plan_id: 'plan-1' },
        } },
      };

      await manejarWebhookStripe(db, evento);

      expect(db._llamadas).toEqual(['suscripciones', 'organizations', 'organizations', 'companies']);
    });

    test('customer.subscription.deleted: marca canceled y suspende la organization', async () => {
      const db = crearMockDb(
        { data: null, error: null }, // update suscripciones estado=canceled
        { data: null, error: null }, // update organizations.estado = suspendida
        { data: { estado: 'suspendida' }, error: null }, // sincronizar: select
        { data: null, error: null }  // sincronizar: update companies
      );
      const evento = {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_stripe_1', metadata: { organization_id: ORG_ID } } },
      };

      await manejarWebhookStripe(db, evento);

      expect(db._llamadas).toEqual(['suscripciones', 'organizations', 'organizations', 'companies']);
    });

    test('invoice.paid: upsert en pagos', async () => {
      const db = crearMockDb({ data: null, error: null });
      const evento = {
        type: 'invoice.paid',
        data: { object: {
          id: 'in_1', amount_due: 99900, currency: 'mxn', status: 'paid',
          created: 1753142400, status_transitions: { paid_at: 1753142500 },
          hosted_invoice_url: 'https://stripe.test/inv', metadata: {},
        } },
      };

      await manejarWebhookStripe(db, evento);

      expect(db._llamadas).toEqual(['pagos']);
    });

    test('evento no manejado: no lanza y no llama a from()', async () => {
      const db = crearMockDb();
      await expect(manejarWebhookStripe(db, { type: 'charge.refunded', data: { object: {} } })).resolves.toBeUndefined();
      expect(db.from).not.toHaveBeenCalled();
    });
  });
});
