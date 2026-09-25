'use strict';

const {
  ESTADOS_INSTALACION, obtenerChecklistConfig, guardarChecklistConfig, crearInstalacion, obtenerInstalacion,
  listarInstalacionesDeProyecto, listarInstalaciones, actualizarInstalacion, actualizarEstadoInstalacion, actualizarChecklistItem,
} = require('../modules/instalaciones');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
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
    checklists_config: { data: { items: [{ clave: 'confirmar_direccion', etiqueta: 'Confirmar dirección' }, { clave: 'revisar_techo', etiqueta: 'Revisar techo' }] }, error: null },
    proyectos: { data: { id: 'proy-1', cliente_id: 214, sucursal_id: 'suc-1', config_vendida: { panel: { cantidad: 8 }, potencia_instalada_kwp: 4.4, inversor: { marca: 'Growatt', modelo: 'MIN 4000TL-X' } } }, error: null },
    instalaciones: { data: null, error: null },
    bitacora_decisiones: { data: { id: 'bit-1' }, error: null },
    usuarios: { data: { nombre: 'Técnico Prueba' }, error: null },
    sucursales: { data: { nombre: 'Sucursal Centro' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_INSTALACION', () => {
  test('los 10 estados pedidos, en orden', () => {
    expect(ESTADOS_INSTALACION).toEqual([
      'por_programar', 'programada', 'preparando_material', 'lista_para_instalacion', 'en_camino',
      'instalando', 'pruebas', 'terminada', 'pendiente_documentacion', 'entregada',
    ]);
  });
});

describe('obtenerChecklistConfig()', () => {
  test('empresa sin checklist configurado → [], nunca inventa uno', async () => {
    const db = crearMockDbPorTabla({ checklists_config: { data: null, error: null } });
    expect(await obtenerChecklistConfig(db, COMPANY_A)).toEqual([]);
  });

  test('con checklist configurado → lo devuelve tal cual', async () => {
    const db = crearMockDbPorTabla();
    const items = await obtenerChecklistConfig(db, COMPANY_A);
    expect(items).toHaveLength(2);
    expect(items[0].clave).toBe('confirmar_direccion');
  });

  test('filtra por tipo (default "instalacion")', async () => {
    const db = crearMockDbPorTabla();
    await obtenerChecklistConfig(db, COMPANY_A);
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('tipo', 'instalacion');
  });
});

describe('guardarChecklistConfig()', () => {
  test('items no es un arreglo → 400', async () => {
    const db = crearMockDbPorTabla();
    await expect(guardarChecklistConfig(db, COMPANY_A, 'instalacion', 'no-array')).rejects.toMatchObject({ status: 400 });
  });

  test('limpia cada item a solo {clave, etiqueta}', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    db.from = jest.fn(() => { const b = crearBuilder({ data: { id: 'cc-1' }, error: null }); b.upsert = jest.fn((p) => { payload = p[0]; return b; }); return b; });

    await guardarChecklistConfig(db, COMPANY_A, 'instalacion', [{ clave: 'x', etiqueta: 'Y', campoExtra: 'ignorar' }]);
    expect(payload.items).toEqual([{ clave: 'x', etiqueta: 'Y' }]);
    expect(payload.company_id).toBe(COMPANY_A);
    expect(payload.tipo).toBe('instalacion');
  });
});

describe('crearInstalacion()', () => {
  test('proyecto inexistente o de otra empresa → 404', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: null, error: null } });
    await expect(crearInstalacion(db, { companyId: COMPANY_A, proyectoId: 'proy-x', usuarioId: 'u1' })).rejects.toMatchObject({ status: 404 });
  });

  test('copia el checklist vigente con completado:false, y detalle_tecnico del snapshot del proyecto', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') {
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1', ...payloadInsert }, error: null });
      }
      return builder;
    });

    await crearInstalacion(db, { companyId: COMPANY_A, proyectoId: 'proy-1', usuarioId: 'u1' });

    expect(payloadInsert.checklist).toEqual([
      { clave: 'confirmar_direccion', etiqueta: 'Confirmar dirección', completado: false, completado_por: null, completado_en: null },
      { clave: 'revisar_techo', etiqueta: 'Revisar techo', completado: false, completado_por: null, completado_en: null },
    ]);
    expect(payloadInsert.detalle_tecnico).toEqual({ numero_paneles: 8, potencia_kwp: 4.4, inversor: { marca: 'Growatt', modelo: 'MIN 4000TL-X' }, microinversores: null, estructura: null });
    expect(payloadInsert.estado).toBe('por_programar');
  });

  test('sin sucursalId explícito → usa la del proyecto', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') {
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1' }, error: null });
      }
      return builder;
    });
    await crearInstalacion(db, { companyId: COMPANY_A, proyectoId: 'proy-1', usuarioId: 'u1' });
    expect(payloadInsert.sucursal_id).toBe('suc-1');
  });

  test('proyecto sin datos de panel/kWp todavía → detalle_tecnico con nulls, nunca lanza', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1', cliente_id: 214, sucursal_id: null, config_vendida: {} }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') {
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1' }, error: null });
      }
      return builder;
    });
    await crearInstalacion(db, { companyId: COMPANY_A, proyectoId: 'proy-1', usuarioId: 'u1' });
    expect(payloadInsert.detalle_tecnico).toEqual({ numero_paneles: null, potencia_kwp: null, inversor: null, microinversores: null, estructura: null });
  });

  test('deja rastro en bitácora con el proyecto y cliente correctos', async () => {
    let payloadBitacora = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1' }, error: null });
      if (tabla === 'bitacora_decisiones') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadBitacora = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await crearInstalacion(db, { companyId: COMPANY_A, proyectoId: 'proy-1', usuarioId: 'user-1' });
    expect(payloadBitacora).toMatchObject({ company_id: COMPANY_A, autor_id: 'user-1', cliente_id: 214, proyecto_id: 'proy-1' });
  });
});

describe('obtenerInstalacion()', () => {
  test('inexistente o de otra empresa → null', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: null } });
    expect(await obtenerInstalacion(db, COMPANY_A, 'inst-x')).toBeNull();
  });

  test('real → enriquecida con responsable/sucursal', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: { id: 'inst-1', company_id: COMPANY_A, responsable_id: 'user-1', sucursal_id: 'suc-1' }, error: null } });
    const r = await obtenerInstalacion(db, COMPANY_A, 'inst-1');
    expect(r).toMatchObject({ responsable_nombre: 'Técnico Prueba', sucursal_nombre: 'Sucursal Centro' });
  });
});

describe('listarInstalacionesDeProyecto() / listarInstalaciones()', () => {
  test('listarInstalacionesDeProyecto: filtra por proyecto_id y company_id', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: [{ id: 'inst-1' }], error: null } });
    await listarInstalacionesDeProyecto(db, COMPANY_A, 'proy-1');
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'instalaciones').value;
    expect(builder.eq).toHaveBeenCalledWith('proyecto_id', 'proy-1');
  });

  test('listarInstalaciones: sin filtro de estado por default', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: [], error: null } });
    const r = await listarInstalaciones(db, COMPANY_A);
    expect(r).toEqual([]);
  });

  test('listarInstalaciones: filtra por estado si se da', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: [], error: null } });
    await listarInstalaciones(db, COMPANY_A, { estado: 'programada' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'instalaciones').value;
    expect(builder.eq).toHaveBeenCalledWith('estado', 'programada');
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: { message: 'boom' } } });
    expect(await listarInstalaciones(db, COMPANY_A)).toEqual([]);
  });
});

describe('actualizarInstalacion()', () => {
  test('aplica solo los campos permitidos', async () => {
    let payload = null;
    const db = crearMockDbPorTabla({ instalaciones: { data: { id: 'inst-1' }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') { const u = builder.update; builder.update = jest.fn((p) => { payload = p; return u.call(builder, p); }); }
      return builder;
    });
    await actualizarInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-1', cambios: { fecha_programada: '2026-10-01', proyecto_id: 'otro-proyecto-intento-de-cambiar' } });
    expect(payload.fecha_programada).toBe('2026-10-01');
    expect(payload.proyecto_id).toBeUndefined();
  });

  test('no encontrada → 404', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: null } });
    await expect(actualizarInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-x', cambios: {} })).rejects.toMatchObject({ status: 404 });
  });
});

describe('actualizarEstadoInstalacion()', () => {
  test('estado no reconocido → 400', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: { id: 'inst-1', estado: 'por_programar', proyecto_id: 'proy-1' }, error: null } });
    await expect(actualizarEstadoInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-1', estado: 'cualquier_cosa', usuarioId: 'u1' })).rejects.toMatchObject({ status: 400 });
  });

  test('instalación inexistente → 404', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: null } });
    await expect(actualizarEstadoInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-x', estado: 'programada', usuarioId: 'u1' })).rejects.toMatchObject({ status: 404 });
  });

  test.each([
    ['por_programar', 'entregada'], // salto grande — deliberadamente permitido, no rígido
    ['terminada', 'por_programar'], // "retroceso" — también permitido
    ['programada', 'en_camino'],
  ])('transición LIBRE de "%s" a "%s" (sin orden rígido, tal como se pidió)', async (desde, hasta) => {
    const db = crearMockDbPorTabla({ instalaciones: { data: { id: 'inst-1', estado: desde, proyecto_id: 'proy-1' }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1', estado: hasta }, error: null });
      return builder;
    });
    const r = await actualizarEstadoInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-1', estado: hasta, usuarioId: 'u1' });
    expect(r.estado).toBe(hasta);
  });

  test('deja rastro en bitácora con el cambio de estado anterior→nuevo', async () => {
    let payloadBitacora = null;
    const db = crearMockDbPorTabla({ instalaciones: { data: { id: 'inst-1', estado: 'programada', proyecto_id: 'proy-1' }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1', estado: 'en_camino' }, error: null });
      if (tabla === 'bitacora_decisiones') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadBitacora = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    await actualizarEstadoInstalacion(db, { companyId: COMPANY_A, instalacionId: 'inst-1', estado: 'en_camino', usuarioId: 'user-1' });
    expect(payloadBitacora.texto).toMatch(/"programada".*"en_camino"/);
    expect(payloadBitacora.proyecto_id).toBe('proy-1');
  });
});

describe('actualizarChecklistItem()', () => {
  const CHECKLIST = [
    { clave: 'confirmar_direccion', etiqueta: 'Confirmar dirección', completado: false, completado_por: null, completado_en: null },
    { clave: 'revisar_techo', etiqueta: 'Revisar techo', completado: false, completado_por: null, completado_en: null },
  ];

  test('instalación inexistente → 404', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: null, error: null } });
    await expect(actualizarChecklistItem(db, { companyId: COMPANY_A, instalacionId: 'inst-x', clave: 'x', completado: true, usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('clave que no existe en ESTE checklist → 404, nunca la agrega', async () => {
    const db = crearMockDbPorTabla({ instalaciones: { data: { checklist: CHECKLIST }, error: null } });
    await expect(actualizarChecklistItem(db, { companyId: COMPANY_A, instalacionId: 'inst-1', clave: 'clave_inventada', completado: true, usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('marcar completado:true → registra quién y cuándo', async () => {
    let payloadUpdate = null;
    const db = crearMockDbPorTabla({ instalaciones: { data: { checklist: CHECKLIST }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') {
        const u = builder.update; builder.update = jest.fn((p) => { payloadUpdate = p; return u.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1', checklist: payloadUpdate?.checklist }, error: null });
      }
      return builder;
    });

    await actualizarChecklistItem(db, { companyId: COMPANY_A, instalacionId: 'inst-1', clave: 'revisar_techo', completado: true, usuarioId: 'user-1' });
    const item = payloadUpdate.checklist.find((it) => it.clave === 'revisar_techo');
    expect(item.completado).toBe(true);
    expect(item.completado_por).toBe('user-1');
    expect(item.completado_en).toEqual(expect.any(String));
    // el otro ítem no se toca
    expect(payloadUpdate.checklist.find((it) => it.clave === 'confirmar_direccion').completado).toBe(false);
  });

  test('desmarcar (completado:false) → limpia quién/cuándo', async () => {
    let payloadUpdate = null;
    const checklistYaMarcado = [{ clave: 'revisar_techo', etiqueta: 'Revisar techo', completado: true, completado_por: 'user-1', completado_en: '2026-09-20T00:00:00Z' }];
    const db = crearMockDbPorTabla({ instalaciones: { data: { checklist: checklistYaMarcado }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'instalaciones') {
        const u = builder.update; builder.update = jest.fn((p) => { payloadUpdate = p; return u.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'inst-1' }, error: null });
      }
      return builder;
    });

    await actualizarChecklistItem(db, { companyId: COMPANY_A, instalacionId: 'inst-1', clave: 'revisar_techo', completado: false, usuarioId: 'user-1' });
    const item = payloadUpdate.checklist[0];
    expect(item.completado).toBe(false);
    expect(item.completado_por).toBeNull();
    expect(item.completado_en).toBeNull();
  });
});
