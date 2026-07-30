'use strict';

const {
  crearSesionDemo, resolverSesionDemoActiva, finalizarSesionDemo, generarResumenSesion,
  listarSesionesActivas, listarEmpresasDemo, normalizarTelefonoMX,
} = require('../modules/plataforma-demo');

// ─── Mock Builder (mismo patrón que __tests__/plataforma-impersonacion.test.js) ──

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    gt:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
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

const ADMIN_ID = 'admin-1';
const COMPANY_ID = 'company-demo-1';

describe('plataforma-demo', () => {
  describe('crearSesionDemo()', () => {
    test('lanza si falta adminId, companyId o authorizedPhone', async () => {
      const db = crearMockDb();
      await expect(crearSesionDemo(db, { companyId: COMPANY_ID, authorizedPhone: '+5210000000001' })).rejects.toThrow(/obligatorios/);
      expect(db.from).not.toHaveBeenCalled();
    });

    test('crea la sesión, invalida caché, resuelve organization_id y audita', async () => {
      const authorizedPhone = '+5210000000002';
      const FILA = { id: 'sesion-1', company_id: COMPANY_ID, admin_id: ADMIN_ID, authorized_phone: authorizedPhone, expira_en: new Date(Date.now() + 3600000).toISOString(), finalizado_en: null };

      const db = crearMockDb(
        { data: null, error: null },                          // check activaExistente → ninguna
        { data: FILA, error: null },                          // insert sesiones_demo
        { data: { organization_id: 'org-1' }, error: null },  // select companies
        { data: null, error: null },                           // insert plataforma_audit_log
      );

      const resultado = await crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, authorizedPhone, duracionMinutos: 60 });

      expect(resultado).toEqual(FILA);
      expect(db._llamadas).toEqual(['sesiones_demo', 'sesiones_demo', 'companies', 'plataforma_audit_log']);
    });

    test('rechaza con status 409 si ya existe una sesión activa para ese teléfono', async () => {
      const authorizedPhone = '+5210000000003';
      const db = crearMockDb({ data: { id: 'sesion-existente' }, error: null });

      await expect(crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, authorizedPhone }))
        .rejects.toMatchObject({ status: 409 });
    });

    test('lanza si el INSERT falla', async () => {
      const authorizedPhone = '+5210000000004';
      const db = crearMockDb(
        { data: null, error: null },
        { data: null, error: { message: 'boom' } },
      );
      await expect(crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, authorizedPhone })).rejects.toThrow(/boom/);
    });

    test('normaliza el teléfono si se escribe sin código de país (bug real de producción, 2026-07-30)', async () => {
      const telefonoCrudo = '8142850036';
      const telefonoEsperado = '+5218142850036';

      const eqCalls = [];
      const insertCalls = [];
      const builder = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn((payload) => { insertCalls.push(payload[0]); return builder; }),
        eq: jest.fn((campo, valor) => { eqCalls.push([campo, valor]); return builder; }),
        is: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: 'sesion-x', authorized_phone: telefonoEsperado }, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        then: (resolve) => resolve({ data: null, error: null }),
      };
      const db = { from: jest.fn(() => builder) };

      await crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, authorizedPhone: telefonoCrudo, duracionMinutos: 30 });

      expect(eqCalls).toContainEqual(['authorized_phone', telefonoEsperado]);
      expect(insertCalls.some(fila => fila.authorized_phone === telefonoEsperado)).toBe(true);
    });
  });

  describe('normalizarTelefonoMX()', () => {
    test('10 dígitos sin código de país → agrega +521', () => {
      expect(normalizarTelefonoMX('8142850036')).toBe('+5218142850036');
    });

    test('+52 + 10 dígitos, sin el "1" de móvil → lo agrega', () => {
      expect(normalizarTelefonoMX('+528142850036')).toBe('+5218142850036');
    });

    test('ya viene en formato correcto (+521 + 10 dígitos) → lo deja igual', () => {
      expect(normalizarTelefonoMX('+5218142850036')).toBe('+5218142850036');
    });

    test('con espacios/guiones → los limpia antes de normalizar', () => {
      expect(normalizarTelefonoMX('81 4285 0036')).toBe('+5218142850036');
    });

    test('número de otro país (no 10/12/13 dígitos reconocidos) → antepone + sin inventar 521', () => {
      expect(normalizarTelefonoMX('+14155238886')).toBe('+14155238886');
    });
  });

  describe('resolverSesionDemoActiva()', () => {
    test('devuelve null sin consultar si no hay teléfono', async () => {
      const db = crearMockDb();
      expect(await resolverSesionDemoActiva(db, null)).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('devuelve la sesión si está vigente (dentro de la ventana)', async () => {
      const authorizedPhone = '+5210000000010';
      const FILA = { id: 'sesion-2', company_id: COMPANY_ID, authorized_phone: authorizedPhone };
      const db = crearMockDb({ data: FILA, error: null });

      const resultado = await resolverSesionDemoActiva(db, authorizedPhone);
      expect(resultado).toEqual(FILA);
    });

    test('devuelve null si no hay ninguna fila (expirada, finalizada, o teléfono sin sesión)', async () => {
      const authorizedPhone = '+5210000000011';
      const db = crearMockDb({ data: null, error: null });

      expect(await resolverSesionDemoActiva(db, authorizedPhone)).toBeNull();
    });

    test('devuelve null si la consulta da error', async () => {
      const authorizedPhone = '+5210000000012';
      const db = crearMockDb({ data: null, error: { message: 'boom' } });

      expect(await resolverSesionDemoActiva(db, authorizedPhone)).toBeNull();
    });

    test('usa caché en la segunda llamada al mismo teléfono (no vuelve a pegarle a la DB)', async () => {
      const authorizedPhone = '+5210000000013';
      const db = crearMockDb({ data: { id: 'sesion-3' }, error: null });

      await resolverSesionDemoActiva(db, authorizedPhone);
      await resolverSesionDemoActiva(db, authorizedPhone);

      expect(db.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('finalizarSesionDemo()', () => {
    test('si la sesión ya no existe o ya estaba cerrada, no hace nada más (devuelve null)', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await finalizarSesionDemo(db, { sesionId: 'inexistente', adminId: ADMIN_ID });

      expect(resultado).toBeNull();
      expect(db._llamadas).toEqual(['sesiones_demo']);
    });

    test('marca finalizado_en, genera el resumen, lo guarda y audita', async () => {
      const authorizedPhone = '+5210000000020';
      const FILA = {
        id: 'sesion-4', company_id: COMPANY_ID, authorized_phone: authorizedPhone,
        iniciado_en: new Date(Date.now() - 60000).toISOString(), finalizado_en: new Date().toISOString(),
      };

      const db = crearMockDb(
        { data: FILA, error: null },               // update finalizado_en
        { data: null, error: null },                // select clientes (sin cliente demo)
        { data: [], error: null },                  // select decision_logs
        { data: null, error: null },                // update resumen
        { data: { organization_id: 'org-1' }, error: null }, // select companies
        { data: null, error: null },                 // insert audit log
      );

      const resultado = await finalizarSesionDemo(db, { sesionId: 'sesion-4', adminId: ADMIN_ID });

      expect(resultado.resumen).toBeDefined();
      expect(resultado.resumen.cliente).toBeNull();
      expect(db._llamadas).toEqual(['sesiones_demo', 'clientes', 'decision_logs', 'sesiones_demo', 'companies', 'plataforma_audit_log']);
    });
  });

  describe('generarResumenSesion()', () => {
    test('sin cliente registrado: no consulta oportunidades/citas, resumen queda con cliente=null y listas vacías', async () => {
      const sesion = { company_id: COMPANY_ID, authorized_phone: '+5210000000030', iniciado_en: new Date(Date.now() - 60000).toISOString() };
      const db = crearMockDb(
        { data: null, error: null }, // clientes
        { data: [], error: null },   // decision_logs
      );

      const resumen = await generarResumenSesion(db, sesion);

      expect(resumen.cliente).toBeNull();
      expect(resumen.oportunidades).toEqual([]);
      expect(resumen.citas).toEqual([]);
      expect(db._llamadas).toEqual(['clientes', 'decision_logs']);
    });

    test('con cliente registrado: agrega oportunidades, citas y conteo de decision_logs por tipo', async () => {
      const sesion = { company_id: COMPANY_ID, authorized_phone: '+5210000000031', iniciado_en: new Date(Date.now() - 60000).toISOString() };
      const CLIENTE = { id: 42, nombre: 'Prospecto Demo', telefono: sesion.authorized_phone };

      const db = crearMockDb(
        { data: CLIENTE, error: null },
        { data: [{ estado: 'Nuevo' }], error: null },        // oportunidades
        { data: [{ estado: 'agendada' }], error: null },     // citas
        { data: [{ tipo: 'ai_call' }, { tipo: 'ai_call' }, { tipo: 'accion' }], error: null }, // decision_logs
      );

      const resumen = await generarResumenSesion(db, sesion);

      expect(resumen.cliente).toEqual(CLIENTE);
      expect(resumen.oportunidades).toEqual([{ estado: 'Nuevo' }]);
      expect(resumen.citas).toEqual([{ estado: 'agendada' }]);
      expect(resumen.acciones_por_tipo).toEqual({ ai_call: 2, accion: 1 });
      expect(typeof resumen.duracion_ms).toBe('number');
    });
  });

  describe('listarSesionesActivas()', () => {
    test('devuelve las sesiones vigentes', async () => {
      const FILAS = [{ id: 'sesion-5', companies: { nombre: 'Empresa Demo Paneles Solares' } }];
      const db = crearMockDb({ data: FILAS, error: null });

      expect(await listarSesionesActivas(db)).toEqual(FILAS);
    });

    test('devuelve arreglo vacío si hay error', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      expect(await listarSesionesActivas(db)).toEqual([]);
    });
  });

  describe('listarEmpresasDemo()', () => {
    test('devuelve solo las empresas marcadas como demo', async () => {
      const FILAS = [{ id: COMPANY_ID, nombre: 'Empresa Demo Paneles Solares', industria_slug: 'paneles_solares' }];
      const db = crearMockDb({ data: FILAS, error: null });

      expect(await listarEmpresasDemo(db)).toEqual(FILAS);
    });

    test('devuelve arreglo vacío si hay error', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      expect(await listarEmpresasDemo(db)).toEqual([]);
    });
  });
});
