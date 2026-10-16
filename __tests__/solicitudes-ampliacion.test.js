'use strict';

const { crearSolicitud, listarSolicitudes, revisarSolicitud } = require('../modules/solicitudes-ampliacion');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn((k, v) => { builder._filtrosEq.push([k, v]); return builder; }),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
    _filtrosEq: [],
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const builders = [];
  const db = {
    from: jest.fn(() => {
      const b = crearBuilder(resultados[idx++] ?? { data: null, error: null });
      builders.push(b);
      return b;
    }),
    _builders: builders,
  };
  return db;
}

const SOLICITUD_PENDIENTE = {
  id: 1, company_id: 'company-a', organization_id: 'org-a', modulo_codigo: 'cotizaciones', estado: 'pendiente',
};

describe('solicitudes-ampliacion', () => {
  describe('crearSolicitud()', () => {
    test('inserta con estado "pendiente" por default (sin duplicado previo)', async () => {
      const db = crearMockDb(
        { data: null, error: null },                        // chequeo de duplicado: no hay pendiente
        { data: { ...SOLICITUD_PENDIENTE }, error: null },   // insert
      );
      const resultado = await crearSolicitud(db, {
        companyId: 'company-a', organizationId: 'org-a', moduloCodigo: 'cotizaciones', solicitadoPor: 'u-1',
      });
      expect(resultado.estado).toBe('pendiente');
    });

    test('CRÍTICO: ya existe una solicitud pendiente del mismo módulo → 409, nunca inserta otra', async () => {
      const db = crearMockDb(
        { data: { id: 99 }, error: null }, // chequeo de duplicado: SÍ hay una pendiente
      );
      await expect(crearSolicitud(db, {
        companyId: 'company-a', organizationId: 'org-a', moduloCodigo: 'cotizaciones', solicitadoPor: 'u-1',
      })).rejects.toMatchObject({ status: 409 });
      // Solo se llamó una vez a .from() (el chequeo) — nunca llegó al insert.
      expect(db.from).toHaveBeenCalledTimes(1);
    });

    test('el chequeo de duplicado filtra por company_id + modulo_codigo + estado=pendiente', async () => {
      const db = crearMockDb({ data: null, error: null }, { data: { ...SOLICITUD_PENDIENTE }, error: null });
      await crearSolicitud(db, { companyId: 'company-a', organizationId: 'org-a', moduloCodigo: 'cotizaciones', solicitadoPor: 'u-1' });
      expect(db._builders[0]._filtrosEq).toContainEqual(['company_id', 'company-a']);
      expect(db._builders[0]._filtrosEq).toContainEqual(['modulo_codigo', 'cotizaciones']);
      expect(db._builders[0]._filtrosEq).toContainEqual(['estado', 'pendiente']);
    });

    test('ampliación general (sin módulo específico): nunca consulta duplicados, siempre inserta', async () => {
      const db = crearMockDb({ data: { ...SOLICITUD_PENDIENTE, modulo_codigo: null }, error: null });
      const resultado = await crearSolicitud(db, { companyId: 'company-a', organizationId: 'org-a', solicitadoPor: 'u-1' });
      expect(resultado).toBeTruthy();
      expect(db.from).toHaveBeenCalledTimes(1); // solo el insert, sin chequeo de duplicado
    });

    test('lanza si Supabase falla en el insert', async () => {
      const db = crearMockDb(
        { data: null, error: null },
        { data: null, error: { message: 'fallo' } },
      );
      await expect(crearSolicitud(db, { companyId: 'c', organizationId: 'o', moduloCodigo: 'crm', solicitadoPor: 'u' })).rejects.toThrow(/fallo/);
    });
  });

  describe('listarSolicitudes()', () => {
    test('sin filtro: no agrega ningún .eq()', async () => {
      const db = crearMockDb({ data: [SOLICITUD_PENDIENTE], error: null });
      const resultado = await listarSolicitudes(db);
      expect(resultado).toEqual([SOLICITUD_PENDIENTE]);
      expect(db._builders[0]._filtrosEq).toEqual([]);
    });

    test('con estado: filtra por esa columna', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarSolicitudes(db, { estado: 'aprobada' });
      expect(db._builders[0]._filtrosEq).toContainEqual(['estado', 'aprobada']);
    });

    test('AISLAMIENTO MULTIEMPRESA: con companyId, filtra por esa columna — "Mis solicitudes" nunca pide otra empresa', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarSolicitudes(db, { companyId: 'company-a' });
      expect(db._builders[0]._filtrosEq).toContainEqual(['company_id', 'company-a']);
    });

    test('sin companyId: nunca agrega un filtro de company_id (uso de Super Admin, ve todas)', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarSolicitudes(db, { estado: 'pendiente' });
      expect(db._builders[0]._filtrosEq.some(([k]) => k === 'company_id')).toBe(false);
    });

    test('error de Supabase: devuelve arreglo vacío', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(listarSolicitudes(db)).resolves.toEqual([]);
    });
  });

  describe('revisarSolicitud()', () => {
    test('solicitud no encontrada: lanza', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(revisarSolicitud(db, 999, { aprobar: true, revisadoPor: 'admin-1' })).rejects.toThrow(/no encontrada/);
    });

    test('solicitud ya revisada (no pendiente): lanza, no la vuelve a tocar', async () => {
      const db = crearMockDb({ data: { ...SOLICITUD_PENDIENTE, estado: 'aprobada' }, error: null });
      await expect(revisarSolicitud(db, 1, { aprobar: false, revisadoPor: 'admin-1' })).rejects.toThrow(/ya fue revisada/);
    });

    test('aprobar con modulo_codigo: actualiza la solicitud Y activa el módulo en modulos_empresa', async () => {
      const db = crearMockDb(
        { data: { ...SOLICITUD_PENDIENTE }, error: null },                                  // leer solicitud
        { data: { ...SOLICITUD_PENDIENTE, estado: 'aprobada' }, error: null },               // update solicitud
        { data: null, error: null },                                                        // upsert modulos_empresa
      );
      const resultado = await revisarSolicitud(db, 1, { aprobar: true, revisadoPor: 'admin-1' });
      expect(resultado.estado).toBe('aprobada');
      expect(db.from).toHaveBeenCalledWith('modulos_empresa');
    });

    test('rechazar: actualiza la solicitud, nunca toca modulos_empresa (nunca activa ni cobra)', async () => {
      const db = crearMockDb(
        { data: { ...SOLICITUD_PENDIENTE }, error: null },
        { data: { ...SOLICITUD_PENDIENTE, estado: 'rechazada' }, error: null },
      );
      const resultado = await revisarSolicitud(db, 1, { aprobar: false, revisadoPor: 'admin-1' });
      expect(resultado.estado).toBe('rechazada');
      expect(db.from).not.toHaveBeenCalledWith('modulos_empresa');
    });

    test('aprobar una ampliación general (modulo_codigo null): nunca toca modulos_empresa', async () => {
      const db = crearMockDb(
        { data: { ...SOLICITUD_PENDIENTE, modulo_codigo: null }, error: null },
        { data: { ...SOLICITUD_PENDIENTE, modulo_codigo: null, estado: 'aprobada' }, error: null },
      );
      const resultado = await revisarSolicitud(db, 1, { aprobar: true, revisadoPor: 'admin-1' });
      expect(resultado.estado).toBe('aprobada');
      expect(db.from).not.toHaveBeenCalledWith('modulos_empresa');
    });
  });

  describe('flujo completo (equivalente sin navegador): empresa solicita → admin aprueba → empresa consulta el resultado', () => {
    test('tras aprobar, una relectura de "Mis solicitudes" de esa empresa ya refleja "aprobada"', async () => {
      // 1. Empresa solicita (sin duplicado previo).
      const dbCrear = crearMockDb({ data: null, error: null }, { data: { ...SOLICITUD_PENDIENTE }, error: null });
      const creada = await crearSolicitud(dbCrear, { companyId: 'company-a', organizationId: 'org-a', moduloCodigo: 'cotizaciones', solicitadoPor: 'u-1' });
      expect(creada.estado).toBe('pendiente');

      // 2. Super Admin aprueba.
      const dbRevisar = crearMockDb(
        { data: { ...creada }, error: null },
        { data: { ...creada, estado: 'aprobada', notas_revision: 'Autorizado por Alina' }, error: null },
        { data: null, error: null },
      );
      await revisarSolicitud(dbRevisar, creada.id, { aprobar: true, revisadoPor: 'admin-1', notasRevision: 'Autorizado por Alina' });

      // 3. La empresa vuelve a consultar "Mis solicitudes" — ya ve el resultado actualizado.
      const dbConsultar = crearMockDb({ data: [{ ...creada, estado: 'aprobada', notas_revision: 'Autorizado por Alina' }], error: null });
      const misSolicitudes = await listarSolicitudes(dbConsultar, { companyId: 'company-a' });
      expect(misSolicitudes[0].estado).toBe('aprobada');
      expect(misSolicitudes[0].notas_revision).toBe('Autorizado por Alina');
    });
  });
});
