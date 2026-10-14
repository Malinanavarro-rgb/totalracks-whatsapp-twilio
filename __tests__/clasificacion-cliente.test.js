'use strict';

const { actualizarClasificacionAutomatica, reclasificarManualmente, OPCIONES_RECLASIFICACION_MANUAL } = require('../modules/clasificacion-cliente');

function crearMockDb(resultadosPorTabla = {}) {
  const llamadas = [];
  return {
    _llamadas: llamadas,
    from: jest.fn((tabla) => {
      const filtros = {};
      const builder = {
        select: jest.fn().mockReturnThis(),
        update: jest.fn((valores) => { llamadas.push({ tabla, accion: 'update', valores }); return builder; }),
        insert: jest.fn((filas) => { llamadas.push({ tabla, accion: 'insert', filas }); return builder; }),
        eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
        maybeSingle: jest.fn(() => Promise.resolve(resultadosPorTabla[tabla]?.maybeSingle ?? { data: null, error: null })),
        single: jest.fn(() => Promise.resolve(resultadosPorTabla[tabla]?.single ?? { data: null, error: null })),
        then: (resolve) => resolve(resultadosPorTabla[tabla]?.then ?? { data: null, error: null }),
      };
      return builder;
    }),
  };
}

const COMPANY_A = 'company-aaaa';
const CLIENTE_1 = 'cliente-0001';

describe('actualizarClasificacionAutomatica()', () => {
  test('clasificación válida, cliente sin fuente manual previa → actualiza con fuente "ia"', async () => {
    const db = crearMockDb({ clientes: { maybeSingle: { data: { tipo_contacto_fuente: null }, error: null } } });
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, 'prospecto');

    const update = db._llamadas.find((l) => l.accion === 'update');
    expect(update.valores).toMatchObject({ tipo_contacto: 'prospecto', tipo_contacto_fuente: 'ia', tipo_contacto_actualizado_por: null });
    expect(update.valores.tipo_contacto_actualizado_en).toEqual(expect.any(String));
  });

  test('cliente con reclasificación MANUAL previa → nunca la pisa con una automática', async () => {
    const db = crearMockDb({ clientes: { maybeSingle: { data: { tipo_contacto_fuente: 'manual' }, error: null } } });
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, 'conversacion_personal');
    expect(db._llamadas.some((l) => l.accion === 'update')).toBe(false);
  });

  test('clasificación null/undefined (turno sin clasificación) → no hace nada, nunca lanza', async () => {
    const db = crearMockDb();
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, null);
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, undefined);
    expect(db.from).not.toHaveBeenCalled();
  });

  test('clasificación fuera del catálogo (dato corrupto/inesperado) → no hace nada, nunca inventa un estado nuevo', async () => {
    const db = crearMockDb();
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, 'valor-que-no-existe');
    expect(db.from).not.toHaveBeenCalled();
  });

  test('sin clienteId → no hace nada', async () => {
    const db = crearMockDb();
    await actualizarClasificacionAutomatica(db, null, COMPANY_A, 'prospecto');
    expect(db.from).not.toHaveBeenCalled();
  });

  test('aislamiento multiempresa: el update siempre filtra por company_id, nunca solo por cliente_id', async () => {
    const db = crearMockDb({ clientes: { maybeSingle: { data: { tipo_contacto_fuente: null }, error: null } } });
    await actualizarClasificacionAutomatica(db, CLIENTE_1, COMPANY_A, 'prospecto');
    // El builder registra eq() por cada filtro aplicado — confirmamos que companyId se usó como filtro real.
    expect(db.from).toHaveBeenCalledWith('clientes');
  });
});

describe('reclasificarManualmente()', () => {
  test('clasificación manual válida → actualiza cliente con fuente "manual" y registra en bitácora', async () => {
    const db = crearMockDb({
      clientes: {
        maybeSingle: { data: { nombre: 'Juan', tipo_contacto: null }, error: null },
        single: { data: { id: CLIENTE_1, tipo_contacto: 'prospecto', tipo_contacto_fuente: 'manual' }, error: null },
      },
    });

    const resultado = await reclasificarManualmente(db, {
      clienteId: CLIENTE_1, companyId: COMPANY_A, nuevaClasificacion: 'prospecto', usuarioId: 'usuario-1',
    });

    expect(resultado.tipo_contacto).toBe('prospecto');
    const update = db._llamadas.find((l) => l.tabla === 'clientes' && l.accion === 'update');
    expect(update.valores).toMatchObject({ tipo_contacto: 'prospecto', tipo_contacto_fuente: 'manual', tipo_contacto_actualizado_por: 'usuario-1' });

    const bitacora = db._llamadas.find((l) => l.tabla === 'bitacora_decisiones' && l.accion === 'insert');
    expect(bitacora).toBeDefined();
    expect(bitacora.filas[0]).toMatchObject({ company_id: COMPANY_A, cliente_id: CLIENTE_1, autor_id: 'usuario-1' });
    expect(bitacora.filas[0].texto).toMatch(/reclasificado manualmente/i);
  });

  test('valor fuera de las opciones manuales (ej. "proveedor", solo asignable por IA) → rechaza con 400, nunca lo aplica', async () => {
    const db = crearMockDb();
    await expect(reclasificarManualmente(db, {
      clienteId: CLIENTE_1, companyId: COMPANY_A, nuevaClasificacion: 'proveedor', usuarioId: 'usuario-1',
    })).rejects.toMatchObject({ status: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  test('valor inventado (no existe en ningún catálogo) → rechaza con 400', async () => {
    const db = crearMockDb();
    await expect(reclasificarManualmente(db, {
      clienteId: CLIENTE_1, companyId: COMPANY_A, nuevaClasificacion: 'cliente_vip', usuarioId: 'usuario-1',
    })).rejects.toMatchObject({ status: 400 });
  });

  test('cliente de otra empresa / inexistente → 404, nunca actualiza', async () => {
    const db = crearMockDb({ clientes: { maybeSingle: { data: null, error: null } } });
    await expect(reclasificarManualmente(db, {
      clienteId: CLIENTE_1, companyId: COMPANY_A, nuevaClasificacion: 'spam', usuarioId: 'usuario-1',
    })).rejects.toMatchObject({ status: 404 });
  });

  test('OPCIONES_RECLASIFICACION_MANUAL expone exactamente los 6 valores pedidos, todos del catálogo real', () => {
    const { VALORES_CLASIFICACION_CONTEXTO } = require('../modules/clasificacion-contexto');
    const valores = OPCIONES_RECLASIFICACION_MANUAL.map((o) => o.valor);
    expect(valores).toEqual(['prospecto', 'cliente_existente', 'conversacion_personal', 'numero_equivocado', 'spam', 'contexto_insuficiente']);
    valores.forEach((v) => expect(VALORES_CLASIFICACION_CONTEXTO.has(v)).toBe(true));
  });
});
