'use strict';

const mockObtenerOCrearCliente = jest.fn();
jest.mock('../modules/crm', () => ({
  obtenerOCrearCliente: (...args) => mockObtenerOCrearCliente(...args),
}));

const { resolverOCrearClientePorCanal } = require('../modules/clientes-identidad');

function crearBuilder(resultado) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    single:      jest.fn().mockResolvedValue(resultado),
  };
  return builder;
}

function crearMockDb(resolvers) {
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      llamadas.push(tabla);
      const resultado = resolvers[tabla] ? resolvers[tabla](llamadas.filter(t => t === tabla).length) : { data: null, error: null };
      return crearBuilder(resultado);
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'company-a-0001';

describe('clientes-identidad', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('canal whatsapp — delega al camino congelado', () => {
    test('llama a obtenerOCrearCliente(identificador, company_id), nunca toca clientes_identidades', async () => {
      mockObtenerOCrearCliente.mockResolvedValue({ id: 1, telefono: '+5218112345678' });
      const db = crearMockDb({});

      const resultado = await resolverOCrearClientePorCanal(db, { canal: 'whatsapp', identificador: '+5218112345678', company_id: COMPANY_A });

      expect(mockObtenerOCrearCliente).toHaveBeenCalledWith('+5218112345678', COMPANY_A);
      expect(resultado).toEqual({ id: 1, telefono: '+5218112345678' });
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe('canal no-whatsapp — resuelve vía clientes_identidades', () => {
    test('identidad ya existe: regresa el cliente vinculado sin crear nada', async () => {
      const db = crearMockDb({
        clientes_identidades: () => ({ data: { cliente_id: 42 }, error: null }),
        clientes: () => ({ data: { id: 42, nombre: 'Ana' }, error: null }),
      });

      const resultado = await resolverOCrearClientePorCanal(db, { canal: 'facebook', identificador: 'psid-123', company_id: COMPANY_A });

      expect(resultado).toEqual({ id: 42, nombre: 'Ana' });
      expect(mockObtenerOCrearCliente).not.toHaveBeenCalled();
    });

    test('identidad nueva: crea cliente y vincula la identidad', async () => {
      const db = crearMockDb({
        clientes_identidades: () => ({ data: null, error: null }),
        clientes:             () => ({ data: { id: 99, nombre: 'Sin nombre' }, error: null }),
      });

      const resultado = await resolverOCrearClientePorCanal(db, { canal: 'instagram', identificador: 'igsid-456', company_id: COMPANY_A });

      expect(resultado).toEqual({ id: 99, nombre: 'Sin nombre' });
      expect(db.from).toHaveBeenCalledWith('clientes');
      expect(db.from).toHaveBeenCalledWith('clientes_identidades');
    });

    test('lanza si falla la consulta de clientes_identidades', async () => {
      const db = crearMockDb({ clientes_identidades: () => ({ data: null, error: { message: 'fallo db' } }) });
      await expect(resolverOCrearClientePorCanal(db, { canal: 'email', identificador: 'a@b.com', company_id: COMPANY_A }))
        .rejects.toThrow('fallo db');
    });
  });

  describe('validaciones', () => {
    test('lanza si falta canal o identificador', async () => {
      const db = crearMockDb({});
      await expect(resolverOCrearClientePorCanal(db, { identificador: 'x', company_id: COMPANY_A })).rejects.toThrow(/requeridos/);
      await expect(resolverOCrearClientePorCanal(db, { canal: 'email', company_id: COMPANY_A })).rejects.toThrow(/requeridos/);
    });
  });
});
