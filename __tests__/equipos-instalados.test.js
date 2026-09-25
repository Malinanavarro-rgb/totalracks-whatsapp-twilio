'use strict';

const {
  crearEquipoInstalado, obtenerEquipoInstalado, listarEquiposDeProyecto, listarEquiposDeInstalacion, actualizarEquipoInstalado,
} = require('../modules/equipos-instalados');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    instalaciones: { data: { id: 'inst-1', proyecto_id: 'proy-1' }, error: null },
    equipos_instalados: { data: null, error: null },
    productos: { data: { garantia_meses: 300 }, error: null },
    bitacora_decisiones: { data: { id: 'bit-1' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

describe('crearEquipoInstalado()', () => {
  test('sin tipoEquipo → 400, nunca inserta', async () => {
    const db = crearMockDbPorTabla();
    await expect(crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('instalación inexistente o de otro proyecto/empresa → 404', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: null } });
    await expect(crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-x', tipoEquipo: 'panel', usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('verifica la cadena completa: instalación debe pertenecer a ESE proyecto y ESA empresa', async () => {
    const db = crearMockDbPorTabla();
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', usuarioId: 'u1' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'instalaciones').value;
    expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(builder.eq).toHaveBeenCalledWith('proyecto_id', 'proy-1');
  });

  test('inserta con los datos correctos', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') {
        const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'eq-1', ...payload }, error: null });
      }
      return builder;
    });

    await crearEquipoInstalado(db, {
      companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel',
      marca: 'LONGi', modelo: 'LR5-54HTH-435M', numeroSerie: 'ABC123', potenciaCapacidad: '435W',
      proveedor: 'Corporativo Soles', fechaInstalacion: '2026-09-25', notas: 'Instalado en fila 2', usuarioId: 'u1',
    });

    expect(payload).toMatchObject({
      company_id: COMPANY_A, proyecto_id: 'proy-1', instalacion_id: 'inst-1', tipo_equipo: 'panel',
      marca: 'LONGi', modelo: 'LR5-54HTH-435M', numero_serie: 'ABC123', potencia_capacidad: '435W',
      proveedor: 'Corporativo Soles', fecha_instalacion: '2026-09-25', notas: 'Instalado en fila 2', registrado_por: 'u1',
    });
  });

  test('garantia_meses explícito tiene prioridad sobre el producto del catálogo', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') { const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', garantiaMeses: 360, productoId: 'prod-1', usuarioId: 'u1' });
    expect(payload.garantia_meses).toBe(360);
  });

  test('sin garantia_meses pero con productoId → la prellena desde productos.garantia_meses', async () => {
    let payload = null;
    const db = crearMockDbPorTabla({ productos: { data: { garantia_meses: 300 }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') { const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', productoId: 'prod-1', usuarioId: 'u1' });
    expect(payload.garantia_meses).toBe(300);
    expect(payload.producto_id).toBe('prod-1');
  });

  test('sin garantia_meses y sin productoId → null, nunca inventa un plazo', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') { const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', usuarioId: 'u1' });
    expect(payload.garantia_meses).toBeNull();
  });

  test('producto del catálogo sin garantia_meses capturada → null, nunca un valor default inventado', async () => {
    let payload = null;
    const db = crearMockDbPorTabla({ productos: { data: { garantia_meses: null }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') { const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', productoId: 'prod-1', usuarioId: 'u1' });
    expect(payload.garantia_meses).toBeNull();
  });

  test('deja rastro en bitácora con marca/modelo/serie y el proyecto correcto', async () => {
    let payloadBitacora = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') builder.single = jest.fn().mockResolvedValue({ data: { id: 'eq-1' }, error: null });
      if (tabla === 'bitacora_decisiones') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadBitacora = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearEquipoInstalado(db, { companyId: COMPANY_A, proyectoId: 'proy-1', instalacionId: 'inst-1', tipoEquipo: 'panel', marca: 'LONGi', numeroSerie: 'ABC123', usuarioId: 'user-1' });
    expect(payloadBitacora).toMatchObject({ company_id: COMPANY_A, autor_id: 'user-1', proyecto_id: 'proy-1' });
    expect(payloadBitacora.texto).toMatch(/panel LONGi.*ABC123/);
  });
});

describe('obtenerEquipoInstalado()', () => {
  test('inexistente o de otra empresa → null', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: null, error: null } });
    expect(await obtenerEquipoInstalado(db, COMPANY_A, 'eq-x')).toBeNull();
  });

  test('real → lo devuelve', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: { id: 'eq-1', tipo_equipo: 'panel' }, error: null } });
    expect(await obtenerEquipoInstalado(db, COMPANY_A, 'eq-1')).toMatchObject({ id: 'eq-1', tipo_equipo: 'panel' });
  });
});

describe('listarEquiposDeProyecto() / listarEquiposDeInstalacion()', () => {
  test('listarEquiposDeProyecto: filtra por proyecto_id y company_id', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: [{ id: 'eq-1' }], error: null } });
    await listarEquiposDeProyecto(db, COMPANY_A, 'proy-1');
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'equipos_instalados').value;
    expect(builder.eq).toHaveBeenCalledWith('proyecto_id', 'proy-1');
    expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
  });

  test('listarEquiposDeInstalacion: filtra por instalacion_id', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: [], error: null } });
    await listarEquiposDeInstalacion(db, COMPANY_A, 'inst-1');
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'equipos_instalados').value;
    expect(builder.eq).toHaveBeenCalledWith('instalacion_id', 'inst-1');
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: null, error: { message: 'boom' } } });
    expect(await listarEquiposDeProyecto(db, COMPANY_A, 'proy-1')).toEqual([]);
  });
});

describe('actualizarEquipoInstalado()', () => {
  test('aplica solo los campos permitidos', async () => {
    let payload = null;
    const db = crearMockDbPorTabla({ equipos_instalados: { data: { id: 'eq-1' }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'equipos_instalados') { const u = builder.update; builder.update = jest.fn((p) => { payload = p; return u.call(builder, p); }); }
      return builder;
    });
    await actualizarEquipoInstalado(db, { companyId: COMPANY_A, equipoId: 'eq-1', cambios: { numero_serie: 'XYZ999', proyecto_id: 'otro-proyecto-intento' } });
    expect(payload.numero_serie).toBe('XYZ999');
    expect(payload.proyecto_id).toBeUndefined();
  });

  test('no encontrado → 404', async () => {
    const db = crearMockDbPorTabla({ equipos_instalados: { data: null, error: null } });
    await expect(actualizarEquipoInstalado(db, { companyId: COMPANY_A, equipoId: 'eq-x', cambios: {} })).rejects.toMatchObject({ status: 404 });
  });
});
