'use strict';

const { obtenerMetricasGenerico, KPI_TIPOS, REGLA_TIPOS, _formatearMs } = require('../modules/dashboard-engine');

function crearBuilder(resultado) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resolvers) {
  return {
    from: jest.fn((tabla) => crearBuilder(resolvers[tabla] ? resolvers[tabla]() : { data: [], count: 0, error: null })),
  };
}

const COMPANY_A = 'company-a';
const AHORA = new Date('2026-07-22T12:00:00Z');

describe('dashboard-engine', () => {
  describe('KPI_TIPOS', () => {
    test('conteo_citas_rango: filtra por estados y rango "hoy"', async () => {
      const db = crearMockDb({ citas: () => ({ count: 5, error: null }) });
      const valor = await KPI_TIPOS.conteo_citas_rango(db, COMPANY_A, { rango: 'hoy', estados: ['agendada', 'confirmada'] }, AHORA);
      expect(valor).toBe(5);
    });

    test('conteo_citas_sin_confirmar', async () => {
      const db = crearMockDb({ citas: () => ({ count: 2, error: null }) });
      const valor = await KPI_TIPOS.conteo_citas_sin_confirmar(db, COMPANY_A, { horas_ventana: 48 }, AHORA);
      expect(valor).toBe(2);
    });

    test('conteo_clientes_nuevos', async () => {
      const db = crearMockDb({ clientes: () => ({ count: 3, error: null }) });
      const valor = await KPI_TIPOS.conteo_clientes_nuevos(db, COMPANY_A, { dias: 7 }, AHORA);
      expect(valor).toBe(3);
    });

    test('conteo_citas_por_estado_desde', async () => {
      const db = crearMockDb({ citas: () => ({ count: 10, error: null }) });
      const valor = await KPI_TIPOS.conteo_citas_por_estado_desde(db, COMPANY_A, { estado: 'completada', desde: 'mes' }, AHORA);
      expect(valor).toBe(10);
    });

    test('conteo_oportunidades_por_estado', async () => {
      const db = crearMockDb({ oportunidades: () => ({ count: 4, error: null }) });
      const valor = await KPI_TIPOS.conteo_oportunidades_por_estado(db, COMPANY_A, { estado: 'Cotización enviada' });
      expect(valor).toBe(4);
    });

    test('suma_oportunidades_mes: suma el campo indicado y formatea moneda', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [{ presupuesto_confirmado: 1000 }, { presupuesto_confirmado: 2500 }], error: null }) });
      const valor = await KPI_TIPOS.suma_oportunidades_mes(db, COMPANY_A, { estado: 'Entregado', campo: 'presupuesto_confirmado', formato: 'moneda' }, AHORA);
      expect(valor).toBe('$3,500');
    });

    test('suma_oportunidades_mes: sin formato, devuelve número crudo', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [{ presupuesto_confirmado: 100 }], error: null }) });
      const valor = await KPI_TIPOS.suma_oportunidades_mes(db, COMPANY_A, { estado: 'Entregado', campo: 'presupuesto_confirmado' }, AHORA);
      expect(valor).toBe(100);
    });

    test('errores de Supabase nunca lanzan — devuelven 0', async () => {
      const db = crearMockDb({ citas: () => ({ count: null, error: { message: 'boom' } }) });
      const valor = await KPI_TIPOS.conteo_citas_rango(db, COMPANY_A, { rango: 'hoy', estados: ['agendada'] }, AHORA);
      expect(valor).toBe(0);
    });
  });

  describe('REGLA_TIPOS', () => {
    test('cita_sin_confirmar_ventana: una recomendación por cita agendada en la ventana', async () => {
      const db = crearMockDb({
        citas: () => ({ data: [{ id: 'c1', cliente_id: 7, inicio: '2026-07-23T10:00:00Z', clientes: { nombre: 'Karla' } }], error: null }),
      });
      const recos = await REGLA_TIPOS.cita_sin_confirmar_ventana(db, COMPANY_A, { horas: 48, severidad: 'critica' }, AHORA);
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toContain('Karla');
      expect(recos[0].severidad).toBe('critica');
      expect(recos[0].recurso).toBe('/crm/clientes/7');
    });

    test('cliente_sin_visita: excluye clientes con cita futura y dentro del umbral', async () => {
      let llamada = 0;
      const db = {
        from: jest.fn((tabla) => {
          llamada++;
          if (tabla === 'citas' && llamada === 1) {
            return crearBuilder({
              data: [
                { cliente_id: 1, inicio: '2026-05-01T00:00:00Z', clientes: { nombre: 'Vieja visita' } }, // hace 82 días → sí aplica
                { cliente_id: 2, inicio: '2026-07-15T00:00:00Z', clientes: { nombre: 'Reciente' } },      // hace 7 días → no aplica
              ], error: null,
            });
          }
          return crearBuilder({ data: [], error: null }); // sin citas futuras
        }),
      };
      const recos = await REGLA_TIPOS.cliente_sin_visita(db, COMPANY_A, { dias: 45, severidad: 'media' }, AHORA);
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toContain('Vieja visita');
    });

    test('oportunidad_estancada: usa la plantilla de mensaje con {cliente}', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [{ id: 'o1', cliente_id: 5, clientes: { nombre: 'Pepe' } }], error: null }) });
      const recos = await REGLA_TIPOS.oportunidad_estancada(db, COMPANY_A, {
        estado: 'Cotización enviada', horas: 48, severidad: 'critica',
        mensaje: '{cliente} lleva más de 48 horas sin seguimiento.', detalle: 'x', accion: 'Dar seguimiento ahora',
      }, AHORA);
      expect(recos[0].texto).toBe('Pepe lleva más de 48 horas sin seguimiento.');
    });

    test('oportunidad_en_estado: una recomendación por cada oportunidad en ese estado', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [{ id: 'o1', cliente_id: 1, clientes: { nombre: 'A' } }, { id: 'o2', cliente_id: 2, clientes: { nombre: 'B' } }], error: null }) });
      const recos = await REGLA_TIPOS.oportunidad_en_estado(db, COMPANY_A, {
        estado: 'Listo para entrega', severidad: 'info', mensaje: 'El pedido de {cliente} está listo.', detalle: 'x', accion: 'Ver',
      });
      expect(recos).toHaveLength(2);
    });

    test('texto_urgente_workflow: detecta palabras de urgencia y deduplica por cliente', async () => {
      const db = crearMockDb({
        workflow_sessions: () => ({
          data: [
            { cliente_id: 1, captured_fields: { fecha_entrega: 'para mañana' }, clientes: { nombre: 'Urgente' } },
            { cliente_id: 1, captured_fields: { fecha_entrega: 'para mañana' }, clientes: { nombre: 'Urgente' } }, // duplicado, mismo cliente
            { cliente_id: 2, captured_fields: { fecha_entrega: 'en un mes' }, clientes: { nombre: 'No urgente' } },
          ], error: null,
        }),
      });
      const recos = await REGLA_TIPOS.texto_urgente_workflow(db, COMPANY_A, { campo: 'fecha_entrega', severidad: 'critica' });
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toContain('Urgente');
    });

    test('texto_urgente_workflow: sin match, no genera nada', async () => {
      const db = crearMockDb({ workflow_sessions: () => ({ data: [{ cliente_id: 1, captured_fields: { fecha_entrega: 'sin prisa' } }], error: null }) });
      const recos = await REGLA_TIPOS.texto_urgente_workflow(db, COMPANY_A, { campo: 'fecha_entrega', severidad: 'critica' });
      expect(recos).toEqual([]);
    });
  });

  describe('obtenerMetricasGenerico()', () => {
    test('arma kpis + recomendaciones a partir de la config, sin ningún if de industria', async () => {
      const db = crearMockDb({
        citas: () => ({ count: 3, data: [], error: null }),
      });
      const config = {
        kpis: [{ tipo: 'conteo_citas_rango', etiqueta: 'Citas de hoy', params: { rango: 'hoy', estados: ['agendada'] } }],
        recomendaciones: [{ tipo: 'cita_sin_confirmar_ventana', params: { horas: 48, severidad: 'critica' } }],
      };
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, config);
      expect(resultado.kpis).toEqual([{ valor: 3, etiqueta: 'Citas de hoy' }]);
      expect(resultado.recomendaciones).toEqual([]);
      expect(resultado.panelVentas).toBeUndefined();
    });

    test('tipo de KPI desconocido: no lanza, devuelve valor "—"', async () => {
      const db = crearMockDb({});
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [{ tipo: 'no_existe', etiqueta: 'X' }], recomendaciones: [] });
      expect(resultado.kpis).toEqual([{ valor: '—', etiqueta: 'X' }]);
    });

    test('tipo de recomendación desconocido: no lanza, se ignora', async () => {
      const db = crearMockDb({});
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [], recomendaciones: [{ tipo: 'no_existe' }] });
      expect(resultado.recomendaciones).toEqual([]);
    });

    test('panel_ventas: true agrega panelVentas con las 3 oportunidades más recientes', async () => {
      const db = crearMockDb({
        oportunidades: () => ({ data: [{ estado: 'Cotizando', presupuesto_confirmado: null, presupuesto_estimado: 500, clientes: { nombre: 'X' } }], error: null }),
      });
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [], recomendaciones: [], panel_ventas: true });
      expect(resultado.panelVentas).toEqual([{ cliente: 'X', estado: 'Cotizando', monto: 500 }]);
    });

  });

  describe('_formatearMs()', () => {
    test('menos de 1000ms se muestra en ms', () => {
      expect(_formatearMs(500)).toBe('500 ms');
    });
    test('1000ms o más se muestra en segundos con 1 decimal', () => {
      expect(_formatearMs(2500)).toBe('2.5 s');
    });
    test('null se muestra como guión', () => {
      expect(_formatearMs(null)).toBe('—');
    });
  });
});
