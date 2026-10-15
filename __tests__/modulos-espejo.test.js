'use strict';

const { calcularEspejoDesdeNavLabels } = require('../modules/modulos-espejo');
const { MODULOS_PERMISOS } = require('../modules/permisos');

describe('calcularEspejoDesdeNavLabels()', () => {
  test('nav_labels real de Nort Energy (snapshot exacto, 2026-10-17, con integrado:true en instalaciones/cobranza) → predicción exacta', () => {
    // Mismo arreglo real leído de producción — con el paso previo del script
    // ya aplicado (integrado:true en instalaciones/cobranza, pedido el
    // 2026-10-17 para no presentarlas como "desactivadas").
    const navNortEnergy = [
      { ruta: '/operaciones', habilitado: true },
      { ruta: '/crm/pipeline', modulo: 'crm', habilitado: true },
      { ruta: '/crm', modulo: 'crm', habilitado: true },
      { ruta: '/centro-conocimiento', habilitado: true },
      { ruta: '/cotizaciones', modulo: 'cotizaciones', habilitado: true },
      { ruta: '/paquetes', habilitado: true },
      { ruta: '/catalogo', habilitado: true },
      { ruta: '/catalogo-tecnico', habilitado: true },
      { ruta: '/conversaciones', habilitado: true },
      { ruta: '/inbox', habilitado: true },
      { ruta: '/agenda', habilitado: true },
      { ruta: '/instalaciones', modulo: 'instalaciones', habilitado: false, integrado: true },
      { ruta: '/tramites-cfe', modulo: 'tramites_cfe', habilitado: true },
      { ruta: '/cobranza', modulo: 'cobranza', habilitado: false, integrado: true },
      { ruta: '/inventario', modulo: 'inventario', habilitado: true },
      { ruta: '/compras', modulo: 'compras', habilitado: true },
      { ruta: '/garantias', modulo: 'garantias', habilitado: true },
      { ruta: '/mantenimiento', modulo: 'mantenimiento', habilitado: true },
      { ruta: '/tickets', modulo: 'tickets', habilitado: true },
      { ruta: '/reportes', habilitado: false },
      { ruta: '/panel-accion', habilitado: true },
      { ruta: '/configuracion', habilitado: true },
    ];

    const espejo = calcularEspejoDesdeNavLabels(navNortEnergy);
    const porModulo = Object.fromEntries(espejo.map((e) => [e.modulo_codigo, e.estado]));

    expect(espejo).toHaveLength(10);
    expect(porModulo).toEqual({
      crm: 'activo', cotizaciones: 'activo', tramites_cfe: 'activo', inventario: 'activo', compras: 'activo',
      garantias: 'activo', mantenimiento: 'activo', tickets: 'activo',
      instalaciones: 'integrado', cobranza: 'integrado',
    });
  });

  test('integrado:true nunca se interpreta como "inactivo" — gana sobre habilitado:false', () => {
    const espejo = calcularEspejoDesdeNavLabels([{ ruta: '/x', modulo: 'instalaciones', habilitado: false, integrado: true }]);
    expect(espejo).toEqual([{ modulo_codigo: 'instalaciones', estado: 'integrado' }]);
  });

  test('habilitado:false SIN integrado → inactivo de verdad, nunca se confunde con integrado', () => {
    const espejo = calcularEspejoDesdeNavLabels([{ ruta: '/x', modulo: 'cobranza', habilitado: false }]);
    expect(espejo).toEqual([{ modulo_codigo: 'cobranza', estado: 'inactivo' }]);
  });

  test('habilitado:true → activo, integrado:true no se necesita ni se infiere para módulos con nav propia', () => {
    const espejo = calcularEspejoDesdeNavLabels([{ ruta: '/x', modulo: 'crm', habilitado: true }]);
    expect(espejo).toEqual([{ modulo_codigo: 'crm', estado: 'activo' }]);
  });

  test('empresa sin ningún campo "modulo" en su nav (las otras 16 empresas reales de TARA hoy) → espejo vacío, nunca inventa filas', () => {
    const navSinModulo = [
      { ruta: '/operaciones', habilitado: true },
      { ruta: '/crm', habilitado: true },
      { ruta: '/agenda', habilitado: true },
    ];
    expect(calcularEspejoDesdeNavLabels(navSinModulo)).toEqual([]);
  });

  test('nav_labels.modulos ausente/null/no-arreglo → espejo vacío, nunca lanza', () => {
    expect(calcularEspejoDesdeNavLabels(undefined)).toEqual([]);
    expect(calcularEspejoDesdeNavLabels(null)).toEqual([]);
    expect(calcularEspejoDesdeNavLabels('no es un arreglo')).toEqual([]);
    expect(calcularEspejoDesdeNavLabels([])).toEqual([]);
  });

  test('el mismo módulo repetido en 2 entradas → una sola fila, gana el estado de mayor prioridad (integrado > activo > inactivo)', () => {
    const nav = [
      { ruta: '/crm/pipeline', modulo: 'crm', habilitado: false },
      { ruta: '/crm', modulo: 'crm', habilitado: true },
    ];
    expect(calcularEspejoDesdeNavLabels(nav)).toEqual([{ modulo_codigo: 'crm', estado: 'activo' }]);
  });

  test('entrada con modulo pero sin habilitado (undefined) → inactivo, nunca se asume activo por default', () => {
    const espejo = calcularEspejoDesdeNavLabels([{ ruta: '/x', modulo: 'tickets' }]);
    expect(espejo).toEqual([{ modulo_codigo: 'tickets', estado: 'inactivo' }]);
  });
});

describe('Catálogo de módulos — consistencia con MODULOS_PERMISOS (regresión)', () => {
  // No se lee el SQL de la migración aquí (no hay motor de SQL en Jest) —
  // esta lista debe mantenerse igual a los codigo: de migrations/128_modulos_catalogo.sql.
  // Si se edita uno, se debe editar el otro — este test es la alarma de esa regla.
  const CODIGOS_CATALOGO_ESPERADOS = [
    'crm', 'cotizaciones', 'agenda', 'proyectos', 'cobranza', 'instalaciones',
    'inventario', 'compras', 'tramites_cfe', 'garantias', 'mantenimiento', 'tickets', 'configuracion',
  ];

  test('los 12 códigos de MODULOS_PERMISOS están todos presentes en el catálogo nuevo, con el mismo texto exacto', () => {
    MODULOS_PERMISOS.forEach((codigo) => expect(CODIGOS_CATALOGO_ESPERADOS).toContain(codigo));
  });

  test('el único código adicional del catálogo nuevo es "agenda" — MODULOS_PERMISOS nunca se tocó', () => {
    const adicionales = CODIGOS_CATALOGO_ESPERADOS.filter((c) => !MODULOS_PERMISOS.includes(c));
    expect(adicionales).toEqual(['agenda']);
  });
});
