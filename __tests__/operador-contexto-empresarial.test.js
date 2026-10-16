'use strict';

const { resolverContextoEmpresarial, listarEmpresasConsultables, estaAutorizada } = require('../modules/operador-contexto-empresarial');

function crearMockDb(resultado) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return { from: jest.fn(() => builder), _builder: builder };
}

const EMPRESA_ACTIVA = { id: 'company-nort', nombre: 'Nort Energy', organization_id: 'org-1', estado: 'activo' };
const EMPRESA_SUSPENDIDA = { id: 'company-susp', nombre: 'Empresa Suspendida', organization_id: 'org-2', estado: 'suspendido' };

describe('operador-contexto-empresarial', () => {
  describe('resolverContextoEmpresarial()', () => {
    test('selección válida: resuelve id/nombre/organization_id', async () => {
      const db = crearMockDb({ data: EMPRESA_ACTIVA, error: null });
      const resultado = await resolverContextoEmpresarial(db, 'company-nort');
      expect(resultado).toEqual({ id: 'company-nort', nombre: 'Nort Energy', organization_id: 'org-1' });
    });

    test('petición sin companyId: 400, nunca llega a consultar la base de datos', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(resolverContextoEmpresarial(db, undefined)).rejects.toMatchObject({ status: 400 });
      expect(db.from).not.toHaveBeenCalled();
    });

    test('companyId vacío o de otro tipo (no string): 400', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(resolverContextoEmpresarial(db, '')).rejects.toMatchObject({ status: 400 });
      await expect(resolverContextoEmpresarial(db, 42)).rejects.toMatchObject({ status: 400 });
    });

    test('empresa inexistente: 404', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(resolverContextoEmpresarial(db, 'company-no-existe')).rejects.toMatchObject({ status: 404 });
    });

    test('empresa existe pero no autorizada (suspendida): 403, nunca regresa el contexto', async () => {
      const db = crearMockDb({ data: EMPRESA_SUSPENDIDA, error: null });
      await expect(resolverContextoEmpresarial(db, 'company-susp')).rejects.toMatchObject({ status: 403 });
    });

    test('error de Supabase: se trata igual que "no existe" (404), nunca expone el error crudo', async () => {
      const db = crearMockDb({ data: null, error: { message: 'timeout' } });
      await expect(resolverContextoEmpresarial(db, 'company-x')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('estaAutorizada()', () => {
    test('empresa activa: autorizada', () => expect(estaAutorizada(EMPRESA_ACTIVA)).toBe(true));
    test('empresa suspendida: no autorizada', () => expect(estaAutorizada(EMPRESA_SUSPENDIDA)).toBe(false));
    test('sin empresa: no autorizada, nunca lanza', () => expect(estaAutorizada(null)).toBe(false));
  });

  describe('listarEmpresasConsultables()', () => {
    test('filtra por estado=activo', async () => {
      const db = crearMockDb({ data: [EMPRESA_ACTIVA], error: null });
      const resultado = await listarEmpresasConsultables(db);
      expect(resultado).toEqual([EMPRESA_ACTIVA]);
      expect(db._builder.eq).toHaveBeenCalledWith('estado', 'activo');
    });

    test('error de Supabase: arreglo vacío, nunca lanza', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(listarEmpresasConsultables(db)).resolves.toEqual([]);
    });
  });
});
