'use strict';

const {
  extensionDeMime, subirDocumentoCliente, clasificarAdjuntoDeMensaje, listarDocumentosCliente,
  adjuntosSinClasificar, eliminarDocumentoCliente, generarUrlFirmadaDocumentoCliente, BUCKET, CATEGORIAS,
} = require('../modules/documentos-cliente');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockStorage({ uploadError = null, removeError = null, signedUrlError = null } = {}) {
  return {
    from: jest.fn(() => ({
      upload: jest.fn().mockResolvedValue({ error: uploadError }),
      remove: jest.fn().mockResolvedValue({ error: removeError }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: signedUrlError ? null : { signedUrl: 'https://firmada.example/x' }, error: signedUrlError }),
    })),
  };
}

const COMPANY_A = 'company-a';
const BUFFER_FAKE = Buffer.from('contenido-fake');

describe('extensionDeMime()', () => {
  test('extrae el subtipo del mime', () => {
    expect(extensionDeMime('image/jpeg')).toBe('jpg');
    expect(extensionDeMime('application/pdf')).toBe('pdf');
  });

  test('sin mime → fallback bin', () => {
    expect(extensionDeMime(undefined)).toBe('bin');
  });
});

describe('CATEGORIAS', () => {
  test('incluye las categorías esperadas por la auditoría', () => {
    expect(CATEGORIAS).toEqual(expect.arrayContaining(['foto_techo', 'foto_medidor', 'foto_centro_carga', 'identificacion', 'contrato']));
  });
});

describe('subirDocumentoCliente()', () => {
  function armarDb(insertResultado = { data: { id: 'doc-1' }, error: null }) {
    let insertado = null;
    const db = { storage: crearMockStorage() };
    db.from = jest.fn(() => { const b = crearBuilder(insertResultado); b.insert = jest.fn((fila) => { insertado = fila; return b; }); return b; });
    return { db, obtenerInsertado: () => insertado };
  }

  test('sube al bucket documentos-cliente y crea la fila con origen subida_manual', async () => {
    const { db, obtenerInsertado } = armarDb();
    const resultado = await subirDocumentoCliente(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'foto_techo', buffer: BUFFER_FAKE, mimeType: 'image/jpeg', nombre_archivo: 'techo.jpg', subido_por: 'user-1' });

    expect(db.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(obtenerInsertado()).toMatchObject({ company_id: COMPANY_A, cliente_id: 214, categoria: 'foto_techo', bucket: BUCKET, origen: 'subida_manual', subido_por: 'user-1' });
    expect(resultado).toEqual({ id: 'doc-1' });
  });

  test('sin company_id/cliente_id → lanza sin tocar storage', async () => {
    const { db } = armarDb();
    await expect(subirDocumentoCliente(db, { categoria: 'foto_techo', buffer: BUFFER_FAKE })).rejects.toThrow('requeridos');
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  test('sin categoria → lanza', async () => {
    const { db } = armarDb();
    await expect(subirDocumentoCliente(db, { company_id: COMPANY_A, cliente_id: 214, buffer: BUFFER_FAKE })).rejects.toThrow('categoria');
  });

  test('sin buffer → lanza sin tocar storage', async () => {
    const { db } = armarDb();
    await expect(subirDocumentoCliente(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'otro' })).rejects.toThrow('vacío');
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  test('error subiendo al bucket → lanza, nunca crea la fila', async () => {
    const db = { storage: crearMockStorage({ uploadError: { message: 'boom' } }) };
    let seInsertó = false;
    db.from = jest.fn(() => { const b = crearBuilder(); b.insert = jest.fn(() => { seInsertó = true; return b; }); return b; });
    await expect(subirDocumentoCliente(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'otro', buffer: BUFFER_FAKE })).rejects.toThrow('boom');
    expect(seInsertó).toBe(false);
  });
});

describe('clasificarAdjuntoDeMensaje()', () => {
  function armarDb({ mensaje, hilo, insertResultado = { data: { id: 'doc-1' }, error: null } }) {
    let insertado = null;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'mensajes') return crearBuilder({ data: mensaje, error: null });
        if (tabla === 'hilos') return crearBuilder({ data: hilo, error: null });
        const b = crearBuilder(insertResultado);
        b.insert = jest.fn((fila) => { insertado = fila; return b; });
        return b;
      }),
    };
    return { db, obtenerInsertado: () => insertado };
  }

  test('clasifica un adjunto real del cliente correcto — referencia el bucket/path original, nunca copia', async () => {
    const mensaje = { id: 'msg-1', hilo_id: 'hilo-1', adjunto_url: 'company-a/hilo-1/foto.jpg', adjunto_mime: 'image/jpeg', company_id: COMPANY_A };
    const { db, obtenerInsertado } = armarDb({ mensaje, hilo: { id: 'hilo-1', cliente_id: 214 } });

    await clasificarAdjuntoDeMensaje(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'foto_medidor', mensaje_id: 'msg-1', subido_por: 'user-1' });

    expect(obtenerInsertado()).toMatchObject({
      company_id: COMPANY_A, cliente_id: 214, categoria: 'foto_medidor',
      bucket: 'inbox-adjuntos', path: 'company-a/hilo-1/foto.jpg', origen: 'mensaje_inbox', mensaje_id: 'msg-1',
    });
  });

  test('sin categoria → lanza', async () => {
    const { db } = armarDb({ mensaje: null, hilo: null });
    await expect(clasificarAdjuntoDeMensaje(db, { company_id: COMPANY_A, cliente_id: 214, mensaje_id: 'msg-1' })).rejects.toThrow('categoria');
  });

  test('mensaje inexistente o de otra empresa → 404', async () => {
    const { db } = armarDb({ mensaje: null, hilo: null });
    await expect(clasificarAdjuntoDeMensaje(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'otro', mensaje_id: 'msg-x' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('mensaje sin adjunto (es texto) → 400, nunca clasifica nada', async () => {
    const { db } = armarDb({ mensaje: { id: 'msg-1', hilo_id: 'hilo-1', adjunto_url: null, company_id: COMPANY_A }, hilo: null });
    await expect(clasificarAdjuntoDeMensaje(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'otro', mensaje_id: 'msg-1' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('el mensaje es de un hilo de OTRO cliente → 403, nunca cruza clientes', async () => {
    const mensaje = { id: 'msg-1', hilo_id: 'hilo-1', adjunto_url: 'x.jpg', company_id: COMPANY_A };
    const { db } = armarDb({ mensaje, hilo: { id: 'hilo-1', cliente_id: 999 } }); // otro cliente
    await expect(clasificarAdjuntoDeMensaje(db, { company_id: COMPANY_A, cliente_id: 214, categoria: 'otro', mensaje_id: 'msg-1' }))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe('listarDocumentosCliente()', () => {
  test('filtra por company_id + cliente_id, y por categoria si se da', async () => {
    const db = crearMockDbSimple({ data: [], error: null });
    await listarDocumentosCliente(db, COMPANY_A, 214, { categoria: 'foto_techo' });
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(builder.eq).toHaveBeenCalledWith('cliente_id', 214);
    expect(builder.eq).toHaveBeenCalledWith('categoria', 'foto_techo');
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDbSimple({ data: null, error: { message: 'boom' } });
    expect(await listarDocumentosCliente(db, COMPANY_A, 214)).toEqual([]);
  });
});

function crearMockDbSimple(resultado) {
  return { from: jest.fn(() => crearBuilder(resultado)) };
}

describe('adjuntosSinClasificar()', () => {
  test('cliente sin hilos → arreglo vacío, nunca consulta mensajes', async () => {
    const db = { from: jest.fn((tabla) => (tabla === 'hilos' ? crearBuilder({ data: [], error: null }) : crearBuilder())) };
    const r = await adjuntosSinClasificar(db, COMPANY_A, 214);
    expect(r).toEqual([]);
    expect(db.from).not.toHaveBeenCalledWith('mensajes');
  });

  test('excluye mensajes YA clasificados (por mensaje_id)', async () => {
    const mensajes = [{ id: 'm1', adjunto_url: 'a.jpg' }, { id: 'm2', adjunto_url: 'b.jpg' }, { id: 'm3', adjunto_url: 'c.jpg' }];
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'hilos') return crearBuilder({ data: [{ id: 'h1' }], error: null });
        if (tabla === 'mensajes') return crearBuilder({ data: mensajes, error: null });
        if (tabla === 'documentos_cliente') return crearBuilder({ data: [{ mensaje_id: 'm2' }], error: null });
        return crearBuilder();
      }),
    };
    const r = await adjuntosSinClasificar(db, COMPANY_A, 214);
    expect(r.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  test('consulta mensajes por los hilos de ESTE cliente (in hiloIds), con adjunto no nulo', async () => {
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'hilos') return crearBuilder({ data: [{ id: 'h1' }, { id: 'h2' }], error: null });
        const b = crearBuilder({ data: [], error: null });
        return b;
      }),
    };
    await adjuntosSinClasificar(db, COMPANY_A, 214);
    const builderMensajes = db.from.mock.results.find((r, i) => db.from.mock.calls[i][0] === 'mensajes').value;
    expect(builderMensajes.in).toHaveBeenCalledWith('hilo_id', ['h1', 'h2']);
    expect(builderMensajes.not).toHaveBeenCalledWith('adjunto_url', 'is', null);
  });
});

describe('eliminarDocumentoCliente()', () => {
  test('origen subida_manual → borra del storage Y la fila', async () => {
    const documento = { id: 'doc-1', bucket: BUCKET, path: 'x/y.jpg', origen: 'subida_manual' };
    const storage = crearMockStorage();
    const db = { storage, from: jest.fn(() => crearBuilder({ data: documento, error: null })) };
    await eliminarDocumentoCliente(db, COMPANY_A, 'doc-1');
    expect(storage.from).toHaveBeenCalledWith(BUCKET);
  });

  test('origen mensaje_inbox → NUNCA borra el archivo del chat, solo la fila', async () => {
    const documento = { id: 'doc-1', bucket: 'inbox-adjuntos', path: 'x/y.jpg', origen: 'mensaje_inbox' };
    const storage = crearMockStorage();
    const db = { storage, from: jest.fn(() => crearBuilder({ data: documento, error: null })) };
    await eliminarDocumentoCliente(db, COMPANY_A, 'doc-1');
    expect(storage.from).not.toHaveBeenCalled();
  });

  test('documento inexistente o de otra empresa → 404', async () => {
    const db = { storage: crearMockStorage(), from: jest.fn(() => crearBuilder({ data: null, error: null })) };
    await expect(eliminarDocumentoCliente(db, COMPANY_A, 'doc-x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('generarUrlFirmadaDocumentoCliente()', () => {
  test('firma contra el bucket QUE TRAE el documento (no siempre BUCKET)', async () => {
    const storage = crearMockStorage();
    const db = { storage };
    const url = await generarUrlFirmadaDocumentoCliente(db, { bucket: 'inbox-adjuntos', path: 'x/y.jpg' });
    expect(storage.from).toHaveBeenCalledWith('inbox-adjuntos');
    expect(url).toBe('https://firmada.example/x');
  });

  test('error generando la URL → lanza', async () => {
    const db = { storage: crearMockStorage({ signedUrlError: { message: 'boom' } }) };
    await expect(generarUrlFirmadaDocumentoCliente(db, { bucket: BUCKET, path: 'x.jpg' })).rejects.toThrow('boom');
  });
});
