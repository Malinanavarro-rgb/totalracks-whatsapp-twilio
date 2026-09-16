/**
 * TARA Matrix™ — Tests: faq-solar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA experta en preguntas/dudas/objeciones (Alina, 2026-09-15 — Nort
 * Energy). Cubre:
 *   - buscarFaqRelevante(): match por palabras clave, ignora palabras vacías
 *   - formatearParaKnowledge(): capas de respuesta + avisos de vigencia/datos del cliente
 *   - obtenerFaqRelevante(): punto de entrada único
 */

'use strict';

const {
  buscarFaqRelevante,
  formatearParaKnowledge,
  obtenerFaqRelevante,
} = require('../modules/faq-solar');

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    // Fase 5: buscarFaqRelevante() incrementa times_asked (fire-and-forget)
    // sobre cada entrada que matchea — mismo builder thenable sirve para
    // el select() de búsqueda y el update() de conteo.
    update: jest.fn().mockReturnThis(),
    then:   (resolve) => resolve(resultado),
  };
}

function crearMockDb(resultado) {
  return { from: jest.fn(() => crearBuilder(resultado)) };
}

function faqBase(overrides = {}) {
  return {
    id: 'f1', company_id: COMPANY_A, category: 'FAQ_BATERIAS',
    question: '¿Con paneles ya no se me va la luz?',
    alternative_phrasings: ['funcionan cuando se va la luz'],
    simple_answer: 'No necesariamente. Los paneles tradicionales dejan de alimentar la casa durante un apagón por seguridad.',
    technical_answer: null,
    sales_followup: '¿Quieres mantener solo lo esencial o toda la casa?',
    requires_current_data: false,
    requires_customer_data: false,
    active: true,
    ...overrides,
  };
}

describe('buscarFaqRelevante()', () => {
  test('mensaje vacío → arreglo vacío, sin consultar la DB', async () => {
    const db = crearMockDb({ data: [], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, '');
    expect(resultado).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  test('encuentra por coincidencia de palabras clave en la pregunta', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se me va la luz?');
    expect(resultado).toHaveLength(1);
  });

  test('encuentra por formulación alternativa, no solo la pregunta principal', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, '¿funcionan los paneles cuando se va la luz?');
    expect(resultado).toHaveLength(1);
  });

  test('palabras vacías comunes ("qué", "es", "mi") no generan match por sí solas', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, '¿qué es esto? ¿cómo va mi pedido?');
    expect(resultado).toEqual([]);
  });

  test('ninguna entrada coincide → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, 'quiero cancelar mi pedido de zapatos');
    expect(resultado).toEqual([]);
  });

  test('sin filas activas en la empresa → arreglo vacío', async () => {
    const db = crearMockDb({ data: [], error: null });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se va la luz');
    expect(resultado).toEqual([]);
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ data: null, error: new Error('boom') });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se va la luz');
    expect(resultado).toEqual([]);
  });

  describe('Fase 5 — analítica de frecuencia (times_asked)', () => {
    test('incrementa times_asked de cada entrada que matchea (+1 sobre su valor actual)', async () => {
      const db = crearMockDb({ data: [faqBase({ times_asked: 4 })], error: null });
      await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se me va la luz?');

      expect(db.from).toHaveBeenCalledWith('solar_faq');
      const builder = db.from.mock.results[1].value; // [0]=búsqueda, [1]=update de conteo
      expect(builder.update).toHaveBeenCalledWith({ times_asked: 5 });
      expect(builder.eq).toHaveBeenCalledWith('id', 'f1');
    });

    test('sin times_asked previo (undefined): arranca en 1, no en NaN', async () => {
      const db = crearMockDb({ data: [faqBase({ times_asked: undefined })], error: null });
      await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se me va la luz?');

      const builder = db.from.mock.results[1].value;
      expect(builder.update).toHaveBeenCalledWith({ times_asked: 1 });
    });

    test('sin ningún match: solo la consulta de búsqueda, ningún update de conteo', async () => {
      const db = crearMockDb({ data: [faqBase()], error: null });
      await buscarFaqRelevante(db, COMPANY_A, 'quiero cancelar mi pedido de zapatos');
      expect(db.from).toHaveBeenCalledTimes(1); // solo el select de búsqueda — cero entradas matchearon, cero updates
    });

    test('si el update falla, nunca lanza ni afecta el resultado ya devuelto', async () => {
      const builderConFalloEnUpdate = {
        select: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        update: jest.fn(() => ({ eq: () => Promise.reject(new Error('fallo de conteo')) })),
        then:   (resolve) => resolve({ data: [faqBase()], error: null }),
      };
      const db = { from: jest.fn(() => builderConFalloEnUpdate) };

      const resultado = await buscarFaqRelevante(db, COMPANY_A, 'con paneles ya no se me va la luz?');
      expect(resultado).toHaveLength(1); // el fallo de conteo nunca tumba la búsqueda real
    });
  });

  test('respeta el límite de resultados', async () => {
    const db = crearMockDb({
      data: [
        faqBase({ id: 'f1', question: '¿con paneles ya no se va la luz?' }),
        faqBase({ id: 'f2', question: 'paneles y apagones de luz' }),
        faqBase({ id: 'f3', question: 'luz durante apagones con paneles' }),
      ],
      error: null,
    });
    const resultado = await buscarFaqRelevante(db, COMPANY_A, 'paneles luz apagones', 2);
    expect(resultado).toHaveLength(2);
  });
});

describe('formatearParaKnowledge()', () => {
  test('arreglo vacío → string vacío', () => {
    expect(formatearParaKnowledge([])).toBe('');
    expect(formatearParaKnowledge(null)).toBe('');
  });

  test('incluye la respuesta sencilla y el siguiente paso sugerido', () => {
    const texto = formatearParaKnowledge([faqBase()]);
    expect(texto).toContain('RESPUESTA SENCILLA');
    expect(texto).toContain('SIGUIENTE PASO SUGERIDO');
    expect(texto).toContain('mantener solo lo esencial');
  });

  test('sin technical_answer, no incluye esa sección', () => {
    const texto = formatearParaKnowledge([faqBase({ technical_answer: null })]);
    expect(texto).not.toContain('RESPUESTA TÉCNICA');
  });

  test('con technical_answer, la incluye marcada como "solo si pide profundizar"', () => {
    const texto = formatearParaKnowledge([faqBase({ technical_answer: 'Detalle técnico real.' })]);
    expect(texto).toContain('RESPUESTA TÉCNICA');
    expect(texto).toContain('Detalle técnico real.');
  });

  test('requires_current_data=true agrega aviso de vigencia', () => {
    const texto = formatearParaKnowledge([faqBase({ requires_current_data: true })]);
    expect(texto).toMatch(/puede cambiar/i);
  });

  test('requires_customer_data=true agrega aviso de que depende del cliente', () => {
    const texto = formatearParaKnowledge([faqBase({ requires_customer_data: true })]);
    expect(texto).toMatch(/depende de datos específicos de este cliente/i);
  });

  test('instruye explícitamente no terminar con "¿en qué más puedo ayudarte?"', () => {
    const texto = formatearParaKnowledge([faqBase()]);
    expect(texto).toMatch(/en qué más puedo ayudarte/i);
  });
});

describe('obtenerFaqRelevante()', () => {
  test('sin match → string vacío', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await obtenerFaqRelevante(db, COMPANY_A, 'hola buenas tardes');
    expect(resultado).toBe('');
  });

  test('con match → texto formateado listo para knowledge_base', async () => {
    const db = crearMockDb({ data: [faqBase()], error: null });
    const resultado = await obtenerFaqRelevante(db, COMPANY_A, 'con paneles ya no se va la luz');
    expect(resultado).toContain('PREGUNTAS FRECUENTES REALES');
  });
});
