'use strict';

const {
  construirRecomendaciones,
  registrarEvento,
  resolverEvento,
} = require('../modules/agenda-engine/recomendaciones');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
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

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

const CONFIG_SALON = {
  terminologia: {
    recurso: { singular: 'Técnica', plural: 'Técnicas' },
    bloque: { singular: 'Cita', plural: 'Citas' },
    contacto: { singular: 'Clienta', plural: 'Clientas' },
  },
};

// Config con terminología deliberadamente distinta — prueba que el texto no
// está hardcodeado a "Técnica"/"Clienta".
const CONFIG_TALLER = {
  terminologia: {
    recurso: { singular: 'Mecánico', plural: 'Mecánicos' },
    bloque: { singular: 'Orden de servicio', plural: 'Órdenes de servicio' },
    contacto: { singular: 'Cliente', plural: 'Clientes' },
  },
};

describe('agenda-engine/recomendaciones', () => {
  describe('construirRecomendaciones()', () => {
    test('retraso usa la terminología de Salón de Belleza', () => {
      const detecciones = [{
        tipo: 'retraso', asesorId: 'a1', asesorNombre: 'Ana Martínez',
        cita: { id: 'c1', inicio: '2026-07-20T17:00:00Z', clientes: { nombre: 'Valeria Cruz' } },
        minutosRetraso: 8,
      }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_SALON);
      expect(r.texto).toContain('Cita de Valeria Cruz con Ana Martínez');
      expect(r.severidad).toBe('critica');
      expect(r.accion).toBe('confirmar_llegada');
    });

    test('la misma detección con terminología de Taller Mecánico no dice "Cita" ni "Clienta"', () => {
      const detecciones = [{
        tipo: 'retraso', asesorId: 'm1', asesorNombre: 'Beto',
        cita: { id: 'c1', inicio: '2026-07-20T17:00:00Z', clientes: { nombre: 'Juan Pérez' } },
        minutosRetraso: 8,
      }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_TALLER);
      expect(r.texto).toContain('Orden de servicio de Juan Pérez con Beto');
      expect(r.texto).not.toMatch(/\bCita\b/);
      expect(r.texto).not.toMatch(/Clienta/);
    });

    test('saturación referencia la cantidad y el plural de "bloque"', () => {
      const detecciones = [{ tipo: 'saturacion', asesorId: 'a1', asesorNombre: 'Paty Reyes', cantidad: 6, citas: [] }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_SALON);
      expect(r.texto).toBe('Paty Reyes tiene 6 citas seguidas sin descanso.');
      expect(r.severidad).toBe('media');
    });

    test('no_show_candidato propone confirmar, nunca marca sola', () => {
      const detecciones = [{
        tipo: 'no_show_candidato', asesorId: 'a1', asesorNombre: 'Ana Martínez',
        cita: { id: 'c1', clientes: { nombre: 'Renata Flores' } }, minutosSinLlegar: 20,
      }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_SALON);
      expect(r.accion).toBe('marcar_no_show');
      expect(r.detalle).toMatch(/¿La marcamos/);
    });

    test('tiempo_muerto usa los minutos directos del hueco (forma plana, no envuelta)', () => {
      const detecciones = [{
        tipo: 'tiempo_muerto', asesorId: 'a1', asesorNombre: 'Vale Salinas',
        inicio: new Date(), fin: new Date(), minutos: 240,
      }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_SALON);
      expect(r.texto).toBe('Vale Salinas lleva 240 min sin actividad.');
    });

    test('hueco_insertable lista los servicios reales que caben', () => {
      const detecciones = [{
        tipo: 'hueco_insertable', asesorId: 'a1', asesorNombre: 'Ana Martínez',
        hueco: { minutos: 45 },
        serviciosQueCaben: [{ id: 's1', nombre: 'Manicure exprés' }],
      }];
      const [r] = construirRecomendaciones(detecciones, CONFIG_SALON);
      expect(r.texto).toContain('Manicure exprés');
      expect(r.accion).toBe('llenar_hueco');
    });

    test('arreglo vacío no lanza', () => {
      expect(construirRecomendaciones([], CONFIG_SALON)).toEqual([]);
    });
  });

  describe('registrarEvento()', () => {
    const evento = { tipo_regla: 'retraso', cita_id: 'c1', asesor_id: 'a1', detectado: { minutosRetraso: 8 }, texto: 'texto' };

    test('inserta un evento nuevo si no hay uno pendiente igual', async () => {
      const db = crearMockDb(
        { data: null, error: null },        // dedup check: no existe
        { data: { id: 'ev1', ...evento }, error: null }, // insert
      );
      const resultado = await registrarEvento(db, COMPANY_A, evento);
      expect(resultado.id).toBe('ev1');
      expect(db._builders[1].insert).toHaveBeenCalledWith(expect.objectContaining({
        company_id: COMPANY_A, tipo_regla: 'retraso', cita_id: 'c1', sugerencia: 'texto',
      }));
    });

    test('no inserta un segundo evento si ya hay uno pendiente para la misma cita', async () => {
      const db = crearMockDb({ data: { id: 'ev-existente' }, error: null });
      const resultado = await registrarEvento(db, COMPANY_A, evento);
      expect(resultado.id).toBe('ev-existente');
      expect(db._builders).toHaveLength(1); // nunca llegó a intentar el insert
    });

    test('eventos sin cita_id (ej. saturación) dedup por asesor_id', async () => {
      const eventoSaturacion = { tipo_regla: 'saturacion', asesor_id: 'a1', detectado: {}, texto: 'x' };
      const db = crearMockDb({ data: null, error: null }, { data: { id: 'ev2' }, error: null });
      await registrarEvento(db, COMPANY_A, eventoSaturacion);
      expect(db._builders[0].eq).toHaveBeenCalledWith('asesor_id', 'a1');
    });
  });

  describe('resolverEvento()', () => {
    test('actualiza estado, accion_tomada y resultado', async () => {
      const db = crearMockDb({ data: { id: 'ev1', estado: 'aceptada' }, error: null });
      const resultado = await resolverEvento(db, COMPANY_A, 'ev1', {
        estado: 'aceptada', accion_tomada: { via: 'reagendarCita' }, resultado: 'Movida a las 4pm',
      });
      expect(resultado.estado).toBe('aceptada');
      expect(db._builders[0].update).toHaveBeenCalledWith(expect.objectContaining({ estado: 'aceptada' }));
    });

    test('lanza si el evento no existe en esa empresa', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(resolverEvento(db, COMPANY_A, 'no-existe', { estado: 'descartada' })).rejects.toThrow();
    });
  });
});
