'use strict';

const {
  DEFAULT_AGENDA_CONFIG,
  validarAgendaConfig,
  obtenerAgendaConfig,
  actualizarAgendaConfig,
} = require('../modules/agenda-config');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
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

function configValido(overrides = {}) {
  return {
    terminologia: {
      recurso:  { singular: 'Técnica', plural: 'Técnicas' },
      bloque:   { singular: 'Cita', plural: 'Citas' },
      contacto: { singular: 'Clienta', plural: 'Clientas' },
    },
    umbrales: {
      citas_seguidas_saturacion: 4,
      minutos_tiempo_muerto: 90,
      margen_retraso_minutos: 5,
      minutos_riesgo_anticipacion: 30,
      hueco_insertable_min: 30,
      hueco_insertable_max: 60,
      no_show_minutos: 15,
    },
    reglas_prioritarias: ['retraso', 'saturacion'],
    ...overrides,
  };
}

describe('agenda-config', () => {
  describe('validarAgendaConfig()', () => {
    test('acepta un config completo y válido', () => {
      expect(() => validarAgendaConfig(configValido())).not.toThrow();
    });

    test('acepta el DEFAULT_AGENDA_CONFIG tal cual', () => {
      expect(() => validarAgendaConfig(DEFAULT_AGENDA_CONFIG)).not.toThrow();
    });

    test('rechaza config nulo o no-objeto', () => {
      expect(() => validarAgendaConfig(null)).toThrow(/objeto/);
      expect(() => validarAgendaConfig('texto')).toThrow(/objeto/);
    });

    test('rechaza si falta terminologia.contacto', () => {
      const config = configValido();
      delete config.terminologia.contacto;
      expect(() => validarAgendaConfig(config)).toThrow(/terminologia.contacto/);
    });

    test('rechaza un umbral faltante', () => {
      const config = configValido();
      delete config.umbrales.margen_retraso_minutos;
      expect(() => validarAgendaConfig(config)).toThrow(/margen_retraso_minutos/);
    });

    test('rechaza un umbral negativo o cero', () => {
      const config = configValido();
      config.umbrales.minutos_tiempo_muerto = 0;
      expect(() => validarAgendaConfig(config)).toThrow(/minutos_tiempo_muerto/);
    });

    test('rechaza reglas_prioritarias vacío', () => {
      const config = configValido({ reglas_prioritarias: [] });
      expect(() => validarAgendaConfig(config)).toThrow(/reglas_prioritarias/);
    });

    test('rechaza una regla desconocida', () => {
      const config = configValido({ reglas_prioritarias: ['retraso', 'algo_inventado'] });
      expect(() => validarAgendaConfig(config)).toThrow(/algo_inventado/);
    });
  });

  describe('obtenerAgendaConfig()', () => {
    test('devuelve la fila real cuando existe', async () => {
      const fila = { company_id: COMPANY_A, schema_version: 1, config: configValido() };
      const db = crearMockDb({ data: fila, error: null });

      const resultado = await obtenerAgendaConfig(db, COMPANY_A);

      expect(resultado).toEqual(fila);
      expect(db._builders[0].eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    });

    test('devuelve null cuando la empresa no tiene fila (señal de Agenda clásica)', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await obtenerAgendaConfig(db, COMPANY_A);
      expect(resultado).toBeNull();
    });

    test('devuelve null (no lanza) si Supabase da error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      const resultado = await obtenerAgendaConfig(db, COMPANY_A);
      expect(resultado).toBeNull();
    });
  });

  describe('actualizarAgendaConfig()', () => {
    test('valida antes de escribir — no llama a Supabase si el config es inválido', async () => {
      const db = crearMockDb();
      const configInvalido = configValido();
      delete configInvalido.umbrales.no_show_minutos;

      await expect(actualizarAgendaConfig(db, COMPANY_A, configInvalido)).rejects.toThrow(/no_show_minutos/);
      expect(db.from).not.toHaveBeenCalled();
    });

    test('hace upsert con onConflict company_id cuando el config es válido', async () => {
      const config = configValido();
      const db = crearMockDb({ data: { company_id: COMPANY_A, schema_version: 1, config }, error: null });

      const resultado = await actualizarAgendaConfig(db, COMPANY_A, config);

      expect(resultado.config).toEqual(config);
      expect(db._builders[0].upsert).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: COMPANY_A, config }),
        { onConflict: 'company_id' }
      );
    });

    test('lanza si Supabase devuelve error al guardar', async () => {
      const config = configValido();
      const db = crearMockDb({ data: null, error: new Error('constraint violada') });
      await expect(actualizarAgendaConfig(db, COMPANY_A, config)).rejects.toThrow('constraint violada');
    });
  });
});
