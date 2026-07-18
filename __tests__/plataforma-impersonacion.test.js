'use strict';

const { iniciarImpersonacion, resolverSesionImpersonada, finalizarImpersonacion } = require('../modules/plataforma-impersonacion');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    gt:          jest.fn().mockReturnThis(),
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
const COMPANY_ID = 'company-1';
const FILA_IMPERSONACION = {
  id: 'imp-1', admin_id: ADMIN_ID, company_id: COMPANY_ID, token: 'tok-abc',
  expira_en: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), finalizado_en: null,
};

describe('plataforma-impersonacion', () => {
  describe('iniciarImpersonacion()', () => {
    test('crea la fila, resuelve organization_id y registra el evento de auditoría', async () => {
      const db = crearMockDb(
        { data: FILA_IMPERSONACION, error: null },      // insert plataforma_impersonaciones
        { data: { organization_id: 'org-1' }, error: null }, // select companies
        { data: null, error: null }                       // insert plataforma_audit_log
      );

      const resultado = await iniciarImpersonacion(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, motivo: 'soporte' });

      expect(db._llamadas).toEqual(['plataforma_impersonaciones', 'companies', 'plataforma_audit_log']);
      expect(resultado).toEqual(FILA_IMPERSONACION);
      expect(typeof resultado.token).toBe('string');
    });

    test('lanza si el INSERT falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(iniciarImpersonacion(db, { adminId: ADMIN_ID, companyId: COMPANY_ID })).rejects.toThrow(/fallo/);
    });
  });

  describe('resolverSesionImpersonada()', () => {
    test('devuelve null sin consultar si no hay token', async () => {
      const db = crearMockDb();
      expect(await resolverSesionImpersonada(db, null)).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('devuelve null si el token no existe/ya expiró/ya se cerró', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await resolverSesionImpersonada(db, 'tok-invalido')).toBeNull();
    });

    test('éxito: sintetiza un usuario con rol owner y es_impersonacion=true', async () => {
      const db = crearMockDb({
        data: { ...FILA_IMPERSONACION, usuarios: { nombre: 'Gabriel' } },
        error: null,
      });

      const usuario = await resolverSesionImpersonada(db, 'tok-abc');

      expect(usuario).toEqual({
        id: ADMIN_ID, nombre: 'Gabriel (soporte)', email: null,
        company_id: COMPANY_ID, rol: 'owner', es_impersonacion: true, impersonacion_id: 'imp-1',
      });
    });
  });

  describe('finalizarImpersonacion()', () => {
    test('marca finalizado_en y registra el evento de auditoría', async () => {
      const db = crearMockDb(
        { data: { ...FILA_IMPERSONACION, finalizado_en: new Date().toISOString() }, error: null }, // update
        { data: { organization_id: 'org-1' }, error: null }, // select companies
        { data: null, error: null } // insert audit log
      );

      await finalizarImpersonacion(db, { token: 'tok-abc', adminId: ADMIN_ID });

      expect(db._llamadas).toEqual(['plataforma_impersonaciones', 'companies', 'plataforma_audit_log']);
    });

    test('si el token ya no existe/ya estaba cerrado, no hace nada más (no lanza)', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(finalizarImpersonacion(db, { token: 'tok-inexistente', adminId: ADMIN_ID })).resolves.toBeUndefined();
      expect(db._llamadas).toEqual(['plataforma_impersonaciones']);
    });
  });
});
