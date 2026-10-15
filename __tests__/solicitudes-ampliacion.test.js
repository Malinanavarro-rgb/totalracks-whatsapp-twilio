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
    test('inserta con estado "pendiente" por default', async () => {
      const db = crearMockDb({ data: { ...SOLICITUD_PENDIENTE }, error: null });
      const resultado = await crearSolicitud(db, {
        companyId: 'company-a', organizationId: 'org-a', moduloCodigo: 'cotizaciones', solicitadoPor: 'u-1',
      });
      expect(resultado.estado).toBe('pendiente');
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(crearSolicitud(db, { companyId: 'c', organizationId: 'o', solicitadoPor: 'u' })).rejects.toThrow(/fallo/);
    });
  });

  describe('listarSolicitudes()', () => {
    test('sin filtro: no agrega .eq("estado", ...)', async () => {
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

    test('rechazar: actualiza la solicitud, nunca toca modulos_empresa', async () => {
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
});
