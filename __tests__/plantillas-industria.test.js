'use strict';

const mockCrearKnowledgeBase = jest.fn().mockResolvedValue({ id: 'kb1' });
const mockCrearServicio      = jest.fn().mockResolvedValue({ id: 's1' });
const mockCrearPipelineEtapa = jest.fn().mockResolvedValue({ id: 'pe1' });
const mockCrearWorkflow      = jest.fn().mockResolvedValue({ id: 'wf1' });
const mockCrearNodo          = jest.fn().mockResolvedValue({ id: 'n1' });
const mockCrearOrganizacionConCompany = jest.fn();

jest.mock('../modules/configuracion', () => ({
  crearKnowledgeBase: (...args) => mockCrearKnowledgeBase(...args),
  crearServicio:      (...args) => mockCrearServicio(...args),
  crearPipelineEtapa: (...args) => mockCrearPipelineEtapa(...args),
}));

jest.mock('../modules/workflow-admin', () => ({
  crearWorkflow: (...args) => mockCrearWorkflow(...args),
  crearNodo:     (...args) => mockCrearNodo(...args),
}));

jest.mock('../modules/organizaciones', () => ({
  crearOrganizacionConCompany: (...args) => mockCrearOrganizacionConCompany(...args),
}));

const { detectarIndustria, aplicarPlantilla, crearEmpresaConIndustria, obtenerPlantillaDeEmpresa } = require('../modules/plantillas-industria');

// ─── Mock Builder (para las queries directas: companies, personalities, plantillas_industria) ──

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

const PLANTILLA_SALON = {
  slug: 'salon_belleza',
  nombre_visible: 'Salón de belleza / uñas',
  palabras_clave: ['uñas', 'manicure', 'pedicure', 'salón'],
  requiere_agenda: true,
  personalidad: {
    nombre_asistente: 'Sofía', cargo: 'Recepcionista virtual', tono: 'cálido', objetivo: 'Agendar citas',
    idioma: 'es', mensaje_fuera_horario: 'fuera de horario', mensaje_error_tecnico: 'error',
  },
  knowledge_base_seed: [{ categoria: 'SERVICIOS', contenido: 'Manicure, pedicure...' }],
  servicios_seed: [{ nombre: 'Manicure clásico', duracion_minutos: 30, precio: 150 }],
  pipeline_etapas_seed: [{ nombre: 'Nuevo', orden: 0 }],
  workflow_seed: {
    nombre: 'Agendar servicio de salón', descripcion: 'Flujo corto', trigger_value: 'solicitud_cotizacion',
    nodos: [{ nombre: 'pedir_servicio', es_inicio: true, es_fin: false, pregunta: '¿Qué servicio?', campo: 'servicio_elegido', orden: 1 }],
  },
};

const PLANTILLA_SOCCER = {
  slug: 'uniformes_deportivos',
  nombre_visible: 'Uniformes deportivos personalizados',
  palabras_clave: ['uniformes', 'soccer', 'deportivo', 'futbol'],
  requiere_agenda: false,
  personalidad: {
    nombre_asistente: 'Diego', cargo: 'Asesor comercial virtual', tono: 'profesional', objetivo: 'Cotizar',
    idioma: 'es', mensaje_fuera_horario: 'fuera de horario', mensaje_error_tecnico: 'error',
  },
  knowledge_base_seed: [{ categoria: 'PRODUCTOS', contenido: 'Uniformes...' }],
  servicios_seed: [],
  pipeline_etapas_seed: [{ nombre: 'Nuevo', orden: 0 }],
  workflow_seed: {
    nombre: 'Cotización de uniformes', descripcion: 'Descubrimiento comercial', trigger_value: 'solicitud_cotizacion',
    nodos: [{ nombre: 'preguntar_deporte', es_inicio: true, es_fin: false, pregunta: '¿Qué deporte?', campo: 'deporte', orden: 1 }],
  },
};

beforeEach(() => jest.clearAllMocks());

describe('plantillas-industria', () => {
  describe('detectarIndustria()', () => {
    test('detecta salón de belleza por palabras clave', () => {
      const resultado = detectarIndustria(
        [PLANTILLA_SALON, PLANTILLA_SOCCER],
        'Somos un salón de manicure y pedicure en Monterrey'
      );
      expect(resultado.slug).toBe('salon_belleza');
    });

    test('detecta uniformes deportivos por palabras clave', () => {
      const resultado = detectarIndustria(
        [PLANTILLA_SALON, PLANTILLA_SOCCER],
        'Fabricamos uniformes deportivos personalizados para equipos de futbol'
      );
      expect(resultado.slug).toBe('uniformes_deportivos');
    });

    test('devuelve null si ninguna palabra clave coincide', () => {
      const resultado = detectarIndustria([PLANTILLA_SALON, PLANTILLA_SOCCER], 'Vendemos tacos y quesadillas');
      expect(resultado).toBeNull();
    });

    test('prioriza la plantilla con más palabras clave coincidentes', () => {
      const resultado = detectarIndustria(
        [PLANTILLA_SALON, PLANTILLA_SOCCER],
        'Tienda de uniformes deportivos personalizados, jerseys de soccer y futbol'
      );
      expect(resultado.slug).toBe('uniformes_deportivos');
    });
  });

  describe('aplicarPlantilla()', () => {
    test('inserta personalidad y reusa crearKnowledgeBase/crearServicio/crearPipelineEtapa/crearWorkflow/crearNodo', async () => {
      const db = crearMockDb({ error: null }); // insert personalities

      await aplicarPlantilla(db, COMPANY_A, PLANTILLA_SALON);

      const builderPersonalidad = db.from.mock.results[0].value;
      expect(builderPersonalidad.insert).toHaveBeenCalledWith([expect.objectContaining({
        company_id: COMPANY_A, nombre_asistente: 'Sofía', cargo: 'Recepcionista virtual',
      })]);

      expect(mockCrearKnowledgeBase).toHaveBeenCalledWith(db, COMPANY_A, PLANTILLA_SALON.knowledge_base_seed[0]);
      expect(mockCrearServicio).toHaveBeenCalledWith(db, COMPANY_A, PLANTILLA_SALON.servicios_seed[0]);
      expect(mockCrearPipelineEtapa).toHaveBeenCalledWith(db, COMPANY_A, PLANTILLA_SALON.pipeline_etapas_seed[0]);
      expect(mockCrearWorkflow).toHaveBeenCalledWith(db, COMPANY_A, expect.objectContaining({ trigger_value: 'solicitud_cotizacion' }));
      expect(mockCrearNodo).toHaveBeenCalledWith(db, COMPANY_A, 'wf1', PLANTILLA_SALON.workflow_seed.nodos[0]);
    });

    test('no llama a crearServicio si la plantilla no requiere agenda', async () => {
      const db = crearMockDb({ error: null });

      await aplicarPlantilla(db, COMPANY_A, PLANTILLA_SOCCER);

      expect(mockCrearServicio).not.toHaveBeenCalled();
    });

    test('lanza si falla el insert de personalidad', async () => {
      const db = crearMockDb({ error: new Error('boom') });
      await expect(aplicarPlantilla(db, COMPANY_A, PLANTILLA_SALON)).rejects.toThrow('boom');
    });
  });

  describe('crearEmpresaConIndustria()', () => {
    test('crea la organización+empresa, detecta la industria y aplica la plantilla', async () => {
      const db = crearMockDb(
        { data: [PLANTILLA_SALON, PLANTILLA_SOCCER], error: null }, // select plantillas_industria
        { error: null },                                            // insert personalities (dentro de aplicarPlantilla)
      );
      mockCrearOrganizacionConCompany.mockResolvedValue({
        organization: { id: 'org-1', nombre: 'Salón de Belleza Ejemplo 2' },
        company: { id: COMPANY_A, nombre: 'Salón de Belleza Ejemplo 2' },
      });

      const resultado = await crearEmpresaConIndustria(db, {
        nombre: 'Salón de Belleza Ejemplo 2',
        descripcionNegocio: 'Salón de manicure y pedicure',
        slug: 'salon-belleza-ejemplo-2',
      });

      expect(mockCrearOrganizacionConCompany).toHaveBeenCalledWith(db, expect.objectContaining({
        nombre: 'Salón de Belleza Ejemplo 2', slug: 'salon-belleza-ejemplo-2', industriaSlug: 'salon_belleza',
      }));
      expect(resultado.organization.id).toBe('org-1');
      expect(resultado.company.id).toBe(COMPANY_A);
      expect(resultado.industriaDetectada).toBe('Salón de belleza / uñas');
      expect(resultado.huboCoincidencia).toBe(true);
      expect(mockCrearWorkflow).toHaveBeenCalled();
    });

    test('si no hay coincidencia, crea la empresa pero no aplica ninguna plantilla', async () => {
      const db = crearMockDb({ data: [PLANTILLA_SALON, PLANTILLA_SOCCER], error: null });
      mockCrearOrganizacionConCompany.mockResolvedValue({
        organization: { id: 'org-2', nombre: 'Taquería Ejemplo' },
        company: { id: COMPANY_A, nombre: 'Taquería Ejemplo' },
      });

      const resultado = await crearEmpresaConIndustria(db, {
        nombre: 'Taquería Ejemplo',
        descripcionNegocio: 'Vendemos tacos',
        slug: 'taqueria-ejemplo',
      });

      expect(mockCrearOrganizacionConCompany).toHaveBeenCalledWith(db, expect.objectContaining({ industriaSlug: null }));
      expect(resultado.huboCoincidencia).toBe(false);
      expect(resultado.industriaDetectada).toBeNull();
      expect(mockCrearWorkflow).not.toHaveBeenCalled();
    });

    test('lanza si falla la creación de la organización/empresa', async () => {
      const db = crearMockDb({ data: [], error: null });
      mockCrearOrganizacionConCompany.mockRejectedValue(new Error('slug duplicado'));
      await expect(crearEmpresaConIndustria(db, { nombre: 'X', descripcionNegocio: 'Y', slug: 'x' }))
        .rejects.toThrow('slug duplicado');
    });
  });

  describe('obtenerPlantillaDeEmpresa()', () => {
    test('devuelve la plantilla de la industria de la empresa', async () => {
      const db = crearMockDb({ data: { industria_slug: 'salon_belleza' }, error: null }, { data: PLANTILLA_SALON, error: null });
      const resultado = await obtenerPlantillaDeEmpresa(db, COMPANY_A);
      expect(resultado).toEqual(PLANTILLA_SALON);
    });

    test('null si la empresa no tiene industria_slug asignado', async () => {
      const db = crearMockDb({ data: { industria_slug: null }, error: null });
      expect(await obtenerPlantillaDeEmpresa(db, COMPANY_A)).toBeNull();
    });

    test('null si falla la consulta de la empresa', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      expect(await obtenerPlantillaDeEmpresa(db, COMPANY_A)).toBeNull();
    });

    test('null si falla la consulta de la plantilla', async () => {
      const db = crearMockDb({ data: { industria_slug: 'salon_belleza' }, error: null }, { data: null, error: { message: 'boom' } });
      expect(await obtenerPlantillaDeEmpresa(db, COMPANY_A)).toBeNull();
    });
  });
});
