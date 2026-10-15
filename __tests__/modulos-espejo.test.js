'use strict';

const { calcularEspejoDesdeNavLabels } = require('../modules/modulos-espejo');
const { MODULOS_PERMISOS } = require('../modules/permisos');

describe('calcularEspejoDesdeNavLabels()', () => {
  test('nav_labels real de Nort Energy (snapshot exacto, 2026-10-16) → predicción exacta: 8 activos, 2 inactivos', () => {
    // Mismo arreglo real leído de producción al diseñar esta fase — fijado
    // aquí para que el test no dependa de que los datos reales no cambien.
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
      { ruta: '/instalaciones', modulo: 'instalaciones', habilitado: false },
      { ruta: '/tramites-cfe', modulo: 'tramites_cfe', habilitado: true },
      { ruta: '/cobranza', modulo: 'cobranza', habilitado: false },
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
    const porModulo = Object.fromEntries(espejo.map((e) => [e.modulo_codigo, e.activo]));

    expect(espejo).toHaveLength(10);
    expect(porModulo).toEqual({
      crm: true, cotizaciones: true, tramites_cfe: true, inventario: true, compras: true,
      garantias: true, mantenimiento: true, tickets: true,
      instalaciones: false, cobranza: false,
    });
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

  test('el mismo módulo repetido en 2 entradas de nav → una sola fila, activo si CUALQUIERA de las entradas está habilitada', () => {
    const nav = [
      { ruta: '/crm/pipeline', modulo: 'crm', habilitado: false },
      { ruta: '/crm', modulo: 'crm', habilitado: true },
    ];
    const espejo = calcularEspejoDesdeNavLabels(nav);
    expect(espejo).toEqual([{ modulo_codigo: 'crm', activo: true }]);
  });

  test('entrada con modulo pero sin habilitado (undefined) → activo false, nunca se asume true por default', () => {
    const espejo = calcularEspejoDesdeNavLabels([{ ruta: '/x', modulo: 'tickets' }]);
    expect(espejo).toEqual([{ modulo_codigo: 'tickets', activo: false }]);
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
