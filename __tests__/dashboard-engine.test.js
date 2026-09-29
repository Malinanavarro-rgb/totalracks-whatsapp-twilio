'use strict';

const { obtenerMetricasGenerico, KPI_TIPOS, REGLA_TIPOS, _formatearMs } = require('../modules/dashboard-engine');

function crearBuilder(resultado) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
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

    // Panel de Cotizaciones (Alina, 2026-08-10)
    test('conteo_cotizaciones_por_estado: con estado', async () => {
      const db = crearMockDb({ cotizaciones: () => ({ count: 6, error: null }) });
      const valor = await KPI_TIPOS.conteo_cotizaciones_por_estado(db, COMPANY_A, { estado: 'enviada' }, AHORA);
      expect(valor).toBe(6);
    });

    test('conteo_cotizaciones_por_estado: sin estado, cuenta todas (ej. "generadas")', async () => {
      const db = crearMockDb({ cotizaciones: () => ({ count: 11, error: null }) });
      const valor = await KPI_TIPOS.conteo_cotizaciones_por_estado(db, COMPANY_A, {}, AHORA);
      expect(valor).toBe(11);
    });

    test('conteo_cotizaciones_por_estado: error de DB → 0, nunca lanza', async () => {
      const db = crearMockDb({ cotizaciones: () => ({ count: null, error: { message: 'boom' } }) });
      const valor = await KPI_TIPOS.conteo_cotizaciones_por_estado(db, COMPANY_A, { estado: 'enviada' }, AHORA);
      expect(valor).toBe(0);
    });

    test('suma_cotizaciones_monto: suma cotizaciones.total y formatea moneda', async () => {
      const db = crearMockDb({ cotizaciones: () => ({ data: [{ total: 94000 }, { total: 64000 }], error: null }) });
      const valor = await KPI_TIPOS.suma_cotizaciones_monto(db, COMPANY_A, { formato: 'moneda' }, AHORA);
      expect(valor).toBe('$158,000');
    });

    test('suma_cotizaciones_monto: sin cotizaciones → $0, no revienta con arreglo vacío', async () => {
      const db = crearMockDb({ cotizaciones: () => ({ data: [], error: null }) });
      const valor = await KPI_TIPOS.suma_cotizaciones_monto(db, COMPANY_A, { formato: 'moneda' }, AHORA);
      expect(valor).toBe('$0');
    });

    test('errores de Supabase nunca lanzan — devuelven 0', async () => {
      const db = crearMockDb({ citas: () => ({ count: null, error: { message: 'boom' } }) });
      const valor = await KPI_TIPOS.conteo_citas_rango(db, COMPANY_A, { rango: 'hoy', estados: ['agendada'] }, AHORA);
      expect(valor).toBe(0);
    });

    // Nort Energy Operations (Alina, 2026-09-09)
    test('conteo_oportunidades_excluyendo_estado: cuenta las que no están en estados_excluidos', async () => {
      const db = crearMockDb({
        oportunidades: () => ({ data: [{ estado: 'Nuevo' }, { estado: 'Cerrado' }, { estado: 'Perdido' }, { estado: 'Calificado' }], error: null }),
      });
      const valor = await KPI_TIPOS.conteo_oportunidades_excluyendo_estado(db, COMPANY_A, { estados_excluidos: ['Cerrado', 'Perdido'] });
      expect(valor).toBe(2);
    });

    test('suma_oportunidades_excluyendo_estado: suma el campo de las que no están en estados_excluidos, formatea moneda', async () => {
      const db = crearMockDb({
        oportunidades: () => ({ data: [{ estado: 'Nuevo', presupuesto_estimado: 1000 }, { estado: 'Cerrado', presupuesto_estimado: 5000 }], error: null }),
      });
      const valor = await KPI_TIPOS.suma_oportunidades_excluyendo_estado(db, COMPANY_A, { estados_excluidos: ['Cerrado', 'Perdido'], campo: 'presupuesto_estimado', formato: 'moneda' });
      expect(valor).toBe('$1,000');
    });

    test('suma_oportunidades_excluyendo_estado: error de DB → "$0" con formato moneda, nunca lanza', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: null, error: { message: 'boom' } }) });
      const valor = await KPI_TIPOS.suma_oportunidades_excluyendo_estado(db, COMPANY_A, { estados_excluidos: [], campo: 'presupuesto_estimado', formato: 'moneda' });
      expect(valor).toBe('$0');
    });

    test('conteo_oportunidades_por_estado_desde: cuenta desde el inicio del mes por updated_at', async () => {
      const db = crearMockDb({ oportunidades: () => ({ count: 3, error: null }) });
      const valor = await KPI_TIPOS.conteo_oportunidades_por_estado_desde(db, COMPANY_A, { estado: 'Cerrado', desde: 'mes' }, AHORA);
      expect(valor).toBe(3);
    });

    test('conteo_citas_futuras: cuenta citas futuras en los estados dados dentro de la ventana', async () => {
      const db = crearMockDb({ citas: () => ({ count: 7, error: null }) });
      const valor = await KPI_TIPOS.conteo_citas_futuras(db, COMPANY_A, { estados: ['agendada', 'confirmada'], dias_ventana: 7 }, AHORA);
      expect(valor).toBe(7);
    });

    test('conteo_tareas_por_estado: cuenta tareas en los estados dados', async () => {
      const db = crearMockDb({ tareas: () => ({ count: 4, error: null }) });
      const valor = await KPI_TIPOS.conteo_tareas_por_estado(db, COMPANY_A, { estados: ['abierta', 'en_progreso'] });
      expect(valor).toBe(4);
    });

    test('conteo_oportunidades_seguimiento_vencido: cuenta las vencidas fuera de estados de cierre', async () => {
      const db = crearMockDb({
        oportunidades: () => ({
          data: [
            { estado: 'Calificado', fecha_seguimiento: '2026-07-20T00:00:00Z' }, // vencida, no cerrada → cuenta
            { estado: 'Cerrado', fecha_seguimiento: '2026-07-19T00:00:00Z' },     // vencida pero cerrada → no cuenta
          ], error: null,
        }),
      });
      const valor = await KPI_TIPOS.conteo_oportunidades_seguimiento_vencido(db, COMPANY_A, { estados_excluidos: ['Cerrado', 'Perdido'] }, AHORA);
      expect(valor).toBe(1);
    });

    test('tasa_conversion_oportunidades: % de ganadas sobre el total de cerradas', async () => {
      const db = crearMockDb({
        oportunidades: () => ({ data: [{ estado: 'Cerrado' }, { estado: 'Cerrado' }, { estado: 'Perdido' }, { estado: 'Nuevo' }], error: null }),
      });
      const valor = await KPI_TIPOS.tasa_conversion_oportunidades(db, COMPANY_A, { estado_ganado: 'Cerrado', estados_cierre: ['Cerrado', 'Perdido'] });
      expect(valor).toBe('67%');
    });

    test('tasa_conversion_oportunidades: sin oportunidades cerradas todavía → "—", no finge 0%', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [{ estado: 'Nuevo' }, { estado: 'Calificado' }], error: null }) });
      const valor = await KPI_TIPOS.tasa_conversion_oportunidades(db, COMPANY_A, { estado_ganado: 'Cerrado', estados_cierre: ['Cerrado', 'Perdido'] });
      expect(valor).toBe('—');
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

    // Nort Energy Operations (Alina, 2026-09-09)
    test('tarea_pendiente: una recomendación por tarea en los estados dados', async () => {
      const db = crearMockDb({
        tareas: () => ({
          data: [{ id: 't1', titulo: 'Enviar propuesta', fecha_limite: '2026-07-25', cliente_id: 3, clientes: { nombre: 'Ana' } }], error: null,
        }),
      });
      const recos = await REGLA_TIPOS.tarea_pendiente(db, COMPANY_A, { estados: ['abierta', 'en_progreso'], severidad: 'media' });
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toBe('Enviar propuesta — Ana');
      expect(recos[0].recurso).toBe('/crm/clientes/3');
    });

    test('tarea_pendiente: sin cliente asociado, cae a /panel-accion', async () => {
      const db = crearMockDb({ tareas: () => ({ data: [{ id: 't1', titulo: 'Revisar inventario', fecha_limite: null, cliente_id: null, clientes: null }], error: null }) });
      const recos = await REGLA_TIPOS.tarea_pendiente(db, COMPANY_A, { estados: ['abierta'], severidad: 'media' });
      expect(recos[0].texto).toBe('Revisar inventario');
      expect(recos[0].recurso).toBe('/panel-accion');
      expect(recos[0].detalle).toBe('Sin fecha límite.');
    });

    test('oportunidad_seguimiento_vencido: una recomendación por oportunidad vencida fuera de estados_excluidos', async () => {
      const db = crearMockDb({
        oportunidades: () => ({
          data: [
            { id: 'o1', cliente_id: 4, estado: 'Calificado', fecha_seguimiento: '2026-07-20T00:00:00Z', clientes: { nombre: 'Luis' } },
            { id: 'o2', cliente_id: 5, estado: 'Cerrado', fecha_seguimiento: '2026-07-19T00:00:00Z', clientes: { nombre: 'Marta' } },
          ], error: null,
        }),
      });
      const recos = await REGLA_TIPOS.oportunidad_seguimiento_vencido(db, COMPANY_A, { estados_excluidos: ['Cerrado', 'Perdido'], severidad: 'alta' }, AHORA);
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toContain('Luis');
      expect(recos[0].recurso).toBe('/crm/clientes/4');
    });

    test('mensaje_sin_responder: sin clientes atendidos por humano, no consulta mensajes ni genera nada', async () => {
      const db = crearMockDb({ clientes: () => ({ data: [], error: null }) });
      const recos = await REGLA_TIPOS.mensaje_sin_responder(db, COMPANY_A, { horas: 24, severidad: 'alta' }, AHORA);
      expect(recos).toEqual([]);
    });

    test('mensaje_sin_responder: cliente tomado por humano con mensaje entrante sin responder', async () => {
      const db = crearMockDb({
        clientes: () => ({ data: [{ id: 8 }], error: null }),
        mensajes_humanos: () => ({ data: [{ cliente_id: 8, created_at: '2026-07-22T10:00:00Z', clientes: { nombre: 'Roberto' } }], error: null }),
      });
      const recos = await REGLA_TIPOS.mensaje_sin_responder(db, COMPANY_A, { horas: 24, severidad: 'alta' }, AHORA);
      expect(recos).toHaveLength(1);
      expect(recos[0].texto).toContain('Roberto');
      expect(recos[0].recurso).toBe('/conversaciones/8');
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

    // Nort Energy Operations (Alina, 2026-09-09)
    test('actividad_reciente: true reusa obtenerActividadReciente() del tablero genérico (modules/dashboard.js), sin duplicar la lógica', async () => {
      const db = crearMockDb({
        clientes: () => ({ data: [{ id: 9, nombre: 'Nueva', telefono: '555', created_at: '2026-07-22T06:00:00Z' }], error: null }),
      });
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [], recomendaciones: [], actividad_reciente: true });
      expect(resultado.actividadReciente).toHaveLength(1);
      expect(resultado.actividadReciente[0].tipo).toBe('cliente_nuevo');
    });

    test('actividad_reciente: ausente, comportamiento previo intacto (arreglo vacío, sin llamadas extra)', async () => {
      const db = crearMockDb({});
      const resultado = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [], recomendaciones: [] });
      expect(resultado.actividadReciente).toEqual([]);
    });
  });

  describe('KPI_TIPOS — P1.3, operación (auditoría 2026-09-29)', () => {
    test('conteo_proyectos_activos: proyectos de venta SIN ninguna instalación entregada/terminada', async () => {
      const db = crearMockDb({
        proyectos: () => ({ data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], error: null }),
        instalaciones: () => ({ data: [{ proyecto_id: 'p2', estado: 'entregada' }], error: null }),
      });
      const valor = await KPI_TIPOS.conteo_proyectos_activos(db, COMPANY_A);
      expect(valor).toBe(2); // p1 y p3, p2 queda excluido
    });

    test('suma_saldo_pendiente_cobranza: suma el saldo de cada proyecto, nunca negativo por proyecto', async () => {
      const db = crearMockDb({
        pagos_cliente: () => ({ data: [{ id: 'pc1', total_vendido: 10000 }, { id: 'pc2', total_vendido: 5000 }], error: null }),
        pagos_cliente_abonos: () => ({ data: [{ pagos_cliente_id: 'pc1', monto: 3000 }, { pagos_cliente_id: 'pc2', monto: 6000 }], error: null }), // pc2 sobrepagado (no debería, pero nunca resta)
      });
      const valor = await KPI_TIPOS.suma_saldo_pendiente_cobranza(db, COMPANY_A, { formato: 'moneda' });
      expect(valor).toBe('$7,000'); // (10000-3000) + max(0, 5000-6000)=0
    });

    test('suma_saldo_pendiente_cobranza: sin pagos_cliente → "$0", nunca lanza', async () => {
      const db = crearMockDb({ pagos_cliente: () => ({ data: [], error: null }) });
      expect(await KPI_TIPOS.suma_saldo_pendiente_cobranza(db, COMPANY_A, { formato: 'moneda' })).toBe('$0');
    });

    test('conteo_proyectos_con_saldo: cuenta solo los que tienen saldo > 0', async () => {
      const db = crearMockDb({
        pagos_cliente: () => ({ data: [{ id: 'pc1', total_vendido: 10000 }, { id: 'pc2', total_vendido: 5000 }], error: null }),
        pagos_cliente_abonos: () => ({ data: [{ pagos_cliente_id: 'pc2', monto: 5000 }], error: null }), // pc2 liquidado
      });
      expect(await KPI_TIPOS.conteo_proyectos_con_saldo(db, COMPANY_A)).toBe(1);
    });

    test('conteo_instalaciones_proximas: filtra por ventana de días', async () => {
      const db = crearMockDb({ instalaciones: () => ({ count: 4, error: null }) });
      expect(await KPI_TIPOS.conteo_instalaciones_proximas(db, COMPANY_A, { dias: 7 }, AHORA)).toBe(4);
    });

    test('conteo_instalaciones_atrasadas: fecha_programada pasada y estado no terminal', async () => {
      const db = crearMockDb({
        instalaciones: () => ({ data: [{ id: 'i1', estado: 'por_programar' }, { id: 'i2', estado: 'entregada' }, { id: 'i3', estado: 'instalando' }], error: null }),
      });
      expect(await KPI_TIPOS.conteo_instalaciones_atrasadas(db, COMPANY_A, {}, AHORA)).toBe(2); // i1, i3 — i2 ya entregada
    });

    test('conteo_tramites_cfe_abiertos: excluye interconexion_completada', async () => {
      const db = crearMockDb({ tramites_cfe: () => ({ count: 3, error: null }) });
      expect(await KPI_TIPOS.conteo_tramites_cfe_abiertos(db, COMPANY_A)).toBe(3);
    });

    test('conteo_tramites_cfe_sin_actualizacion: usa el umbral de la empresa y requiereAlerta real', async () => {
      const haceMucho = new Date(AHORA.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const reciente = AHORA.toISOString();
      const db = crearMockDb({
        tramites_cfe: () => ({ data: [{ estado: 'pendiente', ultima_actualizacion: haceMucho }, { estado: 'pendiente', ultima_actualizacion: reciente }], error: null }),
        companies: () => ({ data: { umbral_dias_alerta_cfe: 7 }, error: null }),
      });
      expect(await KPI_TIPOS.conteo_tramites_cfe_sin_actualizacion(db, COMPANY_A, {}, AHORA)).toBe(1);
    });

    test('conteo_garantias_vigentes: usa calcularVigenciaGarantia real', async () => {
      const db = crearMockDb({
        garantias: () => ({ data: [{ fecha_inicio: '2026-01-01', meses_garantia: 120 }, { fecha_inicio: '2000-01-01', meses_garantia: 12 }], error: null }),
      });
      expect(await KPI_TIPOS.conteo_garantias_vigentes(db, COMPANY_A)).toBe(1);
    });

    test('conteo_mantenimientos_proximos / conteo_mantenimientos_vencidos: usan calcularEstadoMantenimiento real', async () => {
      const hoy = AHORA.toISOString().slice(0, 10);
      const futura = new Date(AHORA.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pasada = new Date(AHORA.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const db = crearMockDb({
        mantenimientos: () => ({
          data: [{ fecha_programada: futura, fecha_realizada: null }, { fecha_programada: pasada, fecha_realizada: null }, { fecha_programada: pasada, fecha_realizada: hoy }],
          error: null,
        }),
      });
      expect(await KPI_TIPOS.conteo_mantenimientos_proximos(db, COMPANY_A, {}, AHORA)).toBe(1);
      expect(await KPI_TIPOS.conteo_mantenimientos_vencidos(db, COMPANY_A, {}, AHORA)).toBe(1);
    });

    test('conteo_tickets_abiertos / conteo_tickets_urgentes', async () => {
      const db = crearMockDb({ tickets: () => ({ count: 6, error: null }) });
      expect(await KPI_TIPOS.conteo_tickets_abiertos(db, COMPANY_A)).toBe(6);
      expect(await KPI_TIPOS.conteo_tickets_urgentes(db, COMPANY_A)).toBe(6);
    });
  });

  describe('REGLA_TIPOS — "Requiere tu atención" (P1.3)', () => {
    test('instalacion_atrasada: una tarjeta por instalación atrasada, recurso al proyecto', async () => {
      const db = crearMockDb({
        instalaciones: () => ({
          data: [{ id: 'i1', fecha_programada: '2026-01-01', estado: 'por_programar', proyecto_id: 'p1', proyectos: { numero_proyecto: 'NE-2026-0001' } }],
          error: null,
        }),
      });
      const r = await REGLA_TIPOS.instalacion_atrasada(db, COMPANY_A, { severidad: 'critica' }, AHORA);
      expect(r).toHaveLength(1);
      expect(r[0].recurso).toBe('/proyectos/p1');
      expect(r[0].categoria).toBe('Instalaciones atrasadas');
    });

    test('cobranza_con_saldo: una tarjeta por proyecto con saldo > 0, severidad "critica" si está vencido', async () => {
      const db = crearMockDb({
        pagos_cliente: () => ({
          data: [{ id: 'pc1', proyecto_id: 'p1', total_vendido: 10000, anticipo_requerido_monto: null, fecha_limite_pago: '2020-01-01', proyectos: { numero_proyecto: 'NE-2026-0001' } }],
          error: null,
        }),
        pagos_cliente_abonos: () => ({ data: [], error: null }),
      });
      const r = await REGLA_TIPOS.cobranza_con_saldo(db, COMPANY_A, { severidad: 'info' });
      expect(r).toHaveLength(1);
      expect(r[0].severidad).toBe('critica'); // vencido siempre se eleva
      expect(r[0].recurso).toBe('/proyectos/p1');
    });

    test('tramite_cfe_sin_actualizacion: una tarjeta por trámite con alerta activa', async () => {
      const haceMucho = new Date(AHORA.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const db = crearMockDb({
        tramites_cfe: () => ({ data: [{ id: 't1', estado: 'pendiente', ultima_actualizacion: haceMucho, proyecto_id: 'p1', proyectos: { numero_proyecto: 'NE-2026-0001' } }], error: null }),
        companies: () => ({ data: { umbral_dias_alerta_cfe: 7 }, error: null }),
      });
      const r = await REGLA_TIPOS.tramite_cfe_sin_actualizacion(db, COMPANY_A, { severidad: 'warning' }, AHORA);
      expect(r).toHaveLength(1);
      expect(r[0].recurso).toBe('/proyectos/p1');
    });

    test('garantia_reclamacion_abierta: excluye resuelta/rechazada', async () => {
      const db = crearMockDb({
        garantia_reclamaciones: () => ({ data: [{ id: 'r1', descripcion: 'Panel no genera', estado: 'abierta', garantia_id: 'g1', created_at: AHORA.toISOString() }], error: null }),
      });
      const r = await REGLA_TIPOS.garantia_reclamacion_abierta(db, COMPANY_A, { severidad: 'warning' });
      expect(r).toHaveLength(1);
      expect(r[0].recurso).toBe('/garantias/g1');
    });

    test('ticket_pendiente: ordena urgentes primero y eleva su severidad', async () => {
      const db = crearMockDb({
        tickets: () => ({
          data: [
            { id: 't1', asunto: 'Duda de factura', prioridad: 'baja', estado: 'abierto', created_at: AHORA.toISOString() },
            { id: 't2', asunto: 'Sin luz', prioridad: 'urgente', estado: 'abierto', created_at: AHORA.toISOString() },
          ],
          error: null,
        }),
      });
      const r = await REGLA_TIPOS.ticket_pendiente(db, COMPANY_A, { severidad: 'info' });
      expect(r).toHaveLength(2);
      expect(r[0].recurso).toBe('/tickets/t2'); // urgente primero
      expect(r[0].severidad).toBe('critica');
      expect(r[1].severidad).toBe('info');
    });
  });

  describe('obtenerMetricasGenerico() — arreglos kpisOperativos/atencion (P1.3)', () => {
    test('sin kpis_operativos ni atencion configurados → arreglos vacíos, comportamiento previo intacto', async () => {
      const db = crearMockDb({});
      const r = await obtenerMetricasGenerico(db, COMPANY_A, { kpis: [], recomendaciones: [] });
      expect(r.kpisOperativos).toEqual([]);
      expect(r.atencion).toEqual([]);
    });

    test('con kpis_operativos configurado → los calcula y los devuelve aparte de kpis comercial', async () => {
      const db = crearMockDb({ tickets: () => ({ count: 3, error: null }) });
      const r = await obtenerMetricasGenerico(db, COMPANY_A, {
        kpis: [], recomendaciones: [],
        kpis_operativos: [{ tipo: 'conteo_tickets_abiertos', etiqueta: 'Tickets abiertos' }],
      });
      expect(r.kpisOperativos).toEqual([{ valor: 3, etiqueta: 'Tickets abiertos' }]);
      expect(r.kpis).toEqual([]); // nunca se mezclan
    });

    test('con atencion configurada → agrega las tarjetas al arreglo atencion, nunca a recomendaciones', async () => {
      const db = crearMockDb({ tickets: () => ({ data: [{ id: 't1', asunto: 'x', prioridad: 'alta', estado: 'abierto', created_at: AHORA.toISOString() }], error: null }) });
      const r = await obtenerMetricasGenerico(db, COMPANY_A, {
        kpis: [], recomendaciones: [],
        atencion: [{ tipo: 'ticket_pendiente', params: { severidad: 'warning' } }],
      });
      expect(r.atencion).toHaveLength(1);
      expect(r.recomendaciones).toEqual([]);
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
