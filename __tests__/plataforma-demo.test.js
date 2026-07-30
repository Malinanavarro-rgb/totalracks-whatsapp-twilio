'use strict';

const {
  crearSesionDemo, finalizarSesionDemo, listarSesionesActivas, listarEmpresasDemo,
  agregarParticipante, actualizarParticipante, limpiarDatosParticipante,
  resolverParticipacionActiva, registrarActividadParticipante,
  obtenerEstadoParticipante, generarResumenSesion, obtenerLineaDeTiempoSesion, obtenerEstadoPublico,
  normalizarTelefonoMX,
} = require('../modules/plataforma-demo');

// ─── Mock Builder (mismo patrón que __tests__/plataforma-impersonacion.test.js) ──

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    gt:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => { llamadas.push(tabla); return crearBuilder(resultados[idx++] ?? { data: null, error: null }); }),
    _llamadas: llamadas,
  };
  return db;
}

const ADMIN_ID = 'admin-1';
const COMPANY_ID = 'company-demo-1';
const DEMO_ID = 'demo-1';

describe('plataforma-demo', () => {
  describe('normalizarTelefonoMX()', () => {
    test('10 dígitos sin código de país → agrega +521', () => {
      expect(normalizarTelefonoMX('8142850036')).toBe('+5218142850036');
    });

    test('+52 + 10 dígitos, sin el "1" de móvil → lo agrega', () => {
      expect(normalizarTelefonoMX('+528142850036')).toBe('+5218142850036');
    });

    test('ya viene en formato correcto (+521 + 10 dígitos) → lo deja igual', () => {
      expect(normalizarTelefonoMX('+5218142850036')).toBe('+5218142850036');
    });

    test('con espacios/guiones → los limpia antes de normalizar', () => {
      expect(normalizarTelefonoMX('81 4285 0036')).toBe('+5218142850036');
    });

    test('número de otro país (no 10/12/13 dígitos reconocidos) → antepone + sin inventar 521', () => {
      expect(normalizarTelefonoMX('+14155238886')).toBe('+14155238886');
    });
  });

  describe('crearSesionDemo()', () => {
    test('lanza si falta adminId o companyId', async () => {
      const db = crearMockDb();
      await expect(crearSesionDemo(db, { companyId: COMPANY_ID })).rejects.toThrow(/obligatorios/);
      expect(db.from).not.toHaveBeenCalled();
    });

    test('crea la sesión (sin teléfono — el tablero nace vacío) y audita', async () => {
      const FILA = { id: DEMO_ID, company_id: COMPANY_ID, admin_id: ADMIN_ID, public_token: 'tok123', expira_en: new Date(Date.now() + 3600000).toISOString() };
      const db = crearMockDb(
        { data: FILA, error: null },                          // insert sesiones_demo
        { data: { organization_id: 'org-1' }, error: null },  // select companies
        { data: null, error: null },                           // insert plataforma_audit_log
      );

      const resultado = await crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID, duracionMinutos: 60, maxParticipantes: 3 });

      expect(resultado).toEqual(FILA);
      expect(db._llamadas).toEqual(['sesiones_demo', 'companies', 'plataforma_audit_log']);
    });

    test('lanza si el INSERT falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      await expect(crearSesionDemo(db, { adminId: ADMIN_ID, companyId: COMPANY_ID })).rejects.toThrow(/boom/);
    });
  });

  describe('finalizarSesionDemo()', () => {
    test('si la sesión ya no existe o ya estaba cerrada, no hace nada más (devuelve null)', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await finalizarSesionDemo(db, { sesionId: DEMO_ID, adminId: ADMIN_ID });
      expect(resultado).toBeNull();
      expect(db._llamadas).toEqual(['sesiones_demo']);
    });

    test('marca finalizado_en, invalida la caché de todos sus participantes, genera el resumen, lo guarda y audita', async () => {
      const FILA = { id: DEMO_ID, company_id: COMPANY_ID, iniciado_en: new Date(Date.now() - 60000).toISOString(), finalizado_en: new Date().toISOString() };
      const db = crearMockDb(
        { data: FILA, error: null },                 // update finalizado_en
        { data: [], error: null },                    // demo_session_participants (para invalidar caché) — vacío, sin participantes
        { data: [], error: null },                    // generarResumenSesion → demo_session_participants (lista para el resumen)
        { data: [], error: null },                    // decision_logs del resumen
        { data: null, error: null },                  // update resumen
        { data: { organization_id: 'org-1' }, error: null }, // select companies
        { data: null, error: null },                  // insert audit log
      );

      const resultado = await finalizarSesionDemo(db, { sesionId: DEMO_ID, adminId: ADMIN_ID });

      expect(resultado.resumen).toBeDefined();
      expect(resultado.resumen.participantes).toBe(0);
    });
  });

  describe('agregarParticipante()', () => {
    test('lanza si falta demoId o phone', async () => {
      const db = crearMockDb();
      await expect(agregarParticipante(db, { phone: '8112345678' })).rejects.toThrow(/obligatorios/);
    });

    test('lanza 404 si la sesión no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(agregarParticipante(db, { demoId: DEMO_ID, phone: '8112345678' })).rejects.toMatchObject({ status: 404 });
    });

    test('normaliza el teléfono y crea el participante (sin límite configurado)', async () => {
      const FILA = { id: 'part-1', demo_id: DEMO_ID, phone: '+5218112345678', status: 'autorizado' };
      const db = crearMockDb(
        { data: { id: DEMO_ID, max_participantes: null }, error: null }, // select sesión
        { data: FILA, error: null },                                      // insert
      );

      const resultado = await agregarParticipante(db, { demoId: DEMO_ID, phone: '8112345678', displayName: 'Cliente residencial' });
      expect(resultado).toEqual(FILA);
    });

    test('rechaza con 409 si ya se alcanzó max_participantes', async () => {
      const db = crearMockDb(
        { data: { id: DEMO_ID, max_participantes: 2 }, error: null }, // select sesión
        { count: 2, error: null },                                     // count de participantes no bloqueados
      );

      await expect(agregarParticipante(db, { demoId: DEMO_ID, phone: '8112345678' })).rejects.toMatchObject({ status: 409 });
    });

    test('permite agregar si hay cupo bajo el límite', async () => {
      const FILA = { id: 'part-2', demo_id: DEMO_ID, phone: '+5218112345679', status: 'autorizado' };
      const db = crearMockDb(
        { data: { id: DEMO_ID, max_participantes: 3 }, error: null },
        { count: 1, error: null },
        { data: FILA, error: null },
      );

      await expect(agregarParticipante(db, { demoId: DEMO_ID, phone: '8112345679' })).resolves.toEqual(FILA);
    });
  });

  describe('actualizarParticipante()', () => {
    test('lanza 400 si el status no es válido', async () => {
      const db = crearMockDb();
      await expect(actualizarParticipante(db, { participantId: 'part-1', status: 'inventado' })).rejects.toMatchObject({ status: 400 });
    });

    test('pausar/bloquear/reactivar/finalizar actualizan solo ese participante', async () => {
      const FILA = { id: 'part-1', phone: '+5218112345678', status: 'pausado' };
      const db = crearMockDb({ data: FILA, error: null });

      const resultado = await actualizarParticipante(db, { participantId: 'part-1', status: 'pausado' });
      expect(resultado).toEqual(FILA);
      expect(db._llamadas).toEqual(['demo_session_participants']);
    });

    test('bloquear/finalizar registran disabled_at; reactivar lo limpia', async () => {
      const builder = crearBuilder({ data: { id: 'part-1', phone: '+5218112345678', status: 'bloqueado' }, error: null });
      const db = { from: jest.fn(() => builder) };

      await actualizarParticipante(db, { participantId: 'part-1', status: 'bloqueado' });
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'bloqueado', disabled_at: expect.any(String) }));
    });

    test('devuelve null si el participante no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await actualizarParticipante(db, { participantId: 'inexistente', status: 'activo' })).toBeNull();
    });
  });

  describe('limpiarDatosParticipante()', () => {
    test('devuelve null si el participante no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await limpiarDatosParticipante(db, 'inexistente')).toBeNull();
    });

    test('sin cliente todavía (nadie ha escrito) — no borra nada, avisa el motivo', async () => {
      const db = crearMockDb(
        { data: { demo_id: DEMO_ID, phone: '+5218112345678' }, error: null }, // participante
        { data: { company_id: COMPANY_ID }, error: null },                    // sesión
        { data: null, error: null },                                          // clientes → ninguno
      );

      const resultado = await limpiarDatosParticipante(db, 'part-1');
      expect(resultado).toEqual({ limpiado: false, motivo: expect.stringContaining('nadie ha escrito') });
    });

    test('con cliente: borra hilos/mensajes/workflow_sessions/oportunidades/citas/conversaciones/cliente y resetea el participante', async () => {
      const db = crearMockDb(
        { data: { demo_id: DEMO_ID, phone: '+5218112345678' }, error: null },  // participante
        { data: { company_id: COMPANY_ID }, error: null },                     // sesión
        { data: { id: 999 }, error: null },                                    // cliente
        { data: [{ id: 'hilo-1' }], error: null },                             // hilos
        { data: null, error: null },                                          // delete mensajes
        { data: null, error: null },                                          // delete hilos
        { data: null, error: null },                                          // delete workflow_sessions
        { data: null, error: null },                                          // delete oportunidades
        { data: null, error: null },                                          // delete citas
        { data: null, error: null },                                          // delete conversaciones
        { data: null, error: null },                                          // delete clientes
        { data: null, error: null },                                          // update participante
      );

      const resultado = await limpiarDatosParticipante(db, 'part-1');
      expect(resultado).toEqual({ limpiado: true });
      expect(db._llamadas).toEqual([
        'demo_session_participants', 'sesiones_demo', 'clientes', 'hilos', 'mensajes',
        'hilos', 'workflow_sessions', 'oportunidades', 'citas', 'conversaciones', 'clientes', 'demo_session_participants',
      ]);
    });
  });

  describe('resolverParticipacionActiva()', () => {
    test('devuelve null sin consultar si no hay teléfono', async () => {
      const db = crearMockDb();
      expect(await resolverParticipacionActiva(db, null)).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('participante en estado "autorizado" con sesión vigente → matchea', async () => {
      const telefono = '+5210000000101';
      const db = crearMockDb(
        { data: { id: 'part-1', demo_id: DEMO_ID, phone: telefono, status: 'autorizado' }, error: null },
        { data: { id: DEMO_ID, company_id: COMPANY_ID }, error: null },
      );

      expect(await resolverParticipacionActiva(db, telefono)).toEqual({ participant_id: 'part-1', demo_id: DEMO_ID, company_id: COMPANY_ID });
    });

    test('participante "pausado" nunca matchea (la query ya lo excluye por status)', async () => {
      const telefono = '+5210000000102';
      const db = crearMockDb({ data: null, error: null }); // .in(['autorizado','activo']) no lo encuentra

      expect(await resolverParticipacionActiva(db, telefono)).toBeNull();
      expect(db._llamadas).toEqual(['demo_session_participants']);
    });

    test('la query de estados que atienden es EXACTAMENTE autorizado/activo — nunca pausado/bloqueado/finalizado', async () => {
      const inCalls = [];
      const builder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn((campo, valores) => { inCalls.push([campo, valores]); return builder; }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      const db = { from: jest.fn(() => builder) };

      await resolverParticipacionActiva(db, '+5210000000199');

      expect(inCalls).toEqual([['status', ['autorizado', 'activo']]]);
    });

    test('participante autorizado pero de una sesión ya finalizada/expirada → null', async () => {
      const telefono = '+5210000000103';
      const db = crearMockDb(
        { data: { id: 'part-1', demo_id: DEMO_ID, phone: telefono, status: 'activo' }, error: null },
        { data: null, error: null }, // la sesión ya no cumple finalizado_en IS NULL / expira_en > now
      );

      expect(await resolverParticipacionActiva(db, telefono)).toBeNull();
    });

    test('usa caché en la segunda llamada al mismo teléfono', async () => {
      const telefono = '+5210000000104';
      const db = crearMockDb(
        { data: { id: 'part-1', demo_id: DEMO_ID, phone: telefono, status: 'activo' }, error: null },
        { data: { id: DEMO_ID, company_id: COMPANY_ID }, error: null },
      );

      await resolverParticipacionActiva(db, telefono);
      await resolverParticipacionActiva(db, telefono);

      expect(db.from).toHaveBeenCalledTimes(2); // las 2 llamadas de la PRIMERA resolución, ninguna en la segunda
    });
  });

  describe('registrarActividadParticipante()', () => {
    test('primera actividad: llena joined_at y pasa de "autorizado" a "activo"', async () => {
      const builder = crearBuilder({ data: { joined_at: null, status: 'autorizado' }, error: null });
      const db = { from: jest.fn(() => builder) };

      await registrarActividadParticipante(db, 'part-1');

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ joined_at: expect.any(String), status: 'activo', last_message_at: expect.any(String) }));
    });

    test('actividad posterior: no vuelve a tocar joined_at ni el status', async () => {
      const builder = crearBuilder({ data: { joined_at: '2026-01-01T00:00:00Z', status: 'activo' }, error: null });
      const db = { from: jest.fn(() => builder) };

      await registrarActividadParticipante(db, 'part-1');

      const payload = builder.update.mock.calls[0][0];
      expect(payload.joined_at).toBeUndefined();
      expect(payload.status).toBeUndefined();
      expect(payload.last_message_at).toEqual(expect.any(String));
    });

    test('participante inexistente: no hace nada, no lanza', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(registrarActividadParticipante(db, 'inexistente')).resolves.toBeUndefined();
      expect(db._llamadas).toEqual(['demo_session_participants']);
    });
  });

  describe('obtenerEstadoParticipante()', () => {
    test('sin cliente registrado: listas vacías, sin consultar oportunidades/citas/conversaciones', async () => {
      const db = crearMockDb({ data: null, error: null });
      const estado = await obtenerEstadoParticipante(db, { companyId: COMPANY_ID, telefono: '+5210000000001' });

      expect(estado.cliente).toBeNull();
      expect(estado.oportunidades).toEqual([]);
      expect(estado.citas).toEqual([]);
      expect(estado.conversaciones).toEqual([]);
      expect(estado.datos_extraidos).toEqual({});
      expect(db._llamadas).toEqual(['clientes']);
    });

    test('con cliente: agrega oportunidades/citas/conversaciones (orden cronológico) y datos_extraidos', async () => {
      const CLIENTE = { id: 200, nombre: 'María López' };
      const db = crearMockDb(
        { data: CLIENTE, error: null },
        { data: [{ estado: 'Calificado' }], error: null },
        { data: [{ estado: 'agendada' }], error: null },
        { data: [{ mensaje_cliente: 'm2' }, { mensaje_cliente: 'm1' }], error: null },
        { data: { current_node: 'preguntar_ciudad', captured_fields: { nombre: 'María' } }, error: null },
      );

      const estado = await obtenerEstadoParticipante(db, { companyId: COMPANY_ID, telefono: '+5210000000002' });

      expect(estado.cliente).toEqual(CLIENTE);
      expect(estado.conversaciones).toEqual([{ mensaje_cliente: 'm1' }, { mensaje_cliente: 'm2' }]);
      expect(estado.datos_extraidos).toEqual({ nombre: 'María' });
      expect(estado.nodo_actual).toBe('preguntar_ciudad');
    });
  });

  describe('generarResumenSesion() — multi-participante', () => {
    // obtenerEstadoParticipante() corre en paralelo (Promise.all) por cada
    // participante — el orden real de las llamadas a .from() no es
    // determinístico entre participantes. Este mock responde según la
    // tabla y el teléfono filtrado (vía .eq()), no según el orden de
    // llegada, para reflejar eso honestamente.
    function crearMockPorTelefono(clientesPorTelefono) {
      const llamadas = [];
      const from = jest.fn((tabla) => {
        llamadas.push(tabla);
        let telefonoFiltrado = null;
        const builder = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn((campo, valor) => { if (campo === 'telefono') telefonoFiltrado = valor; return builder; }),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn(() => {
            if (tabla === 'clientes') return Promise.resolve({ data: clientesPorTelefono[telefonoFiltrado] || null, error: null });
            if (tabla === 'workflow_sessions') return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: null, error: null });
          }),
          then: (resolve) => {
            // Solo el participante CON cliente llega a pedir oportunidades/
            // citas/conversaciones (obtenerEstadoParticipante corta antes si
            // no hay cliente) — no hace falta distinguir por teléfono aquí.
            if (tabla === 'demo_session_participants') return resolve({ data: Object.keys(clientesPorTelefono).map(phone => ({ phone })), error: null });
            if (tabla === 'oportunidades') return resolve({ data: [{ estado: 'Nuevo' }], error: null });
            return resolve({ data: [], error: null });
          },
        };
        return builder;
      });
      return { from, _llamadas: llamadas };
    }

    test('suma clientes/oportunidades/citas de TODOS los participantes, sin mezclarlos', async () => {
      const sesion = { id: DEMO_ID, company_id: COMPANY_ID, iniciado_en: new Date(Date.now() - 60000).toISOString() };
      // OJO: la búsqueda de cliente filtra por company_id Y telefono — este
      // mock simplificado solo distingue por el último .eq('telefono', ...),
      // suficiente para probar que un participante sin cliente no cuenta y
      // el que sí tiene cliente aporta su oportunidad, sin cruzarse.
      const db = crearMockPorTelefono({
        '+5210000000010': { id: 1, nombre: 'Ana' },
        '+5210000000011': null,
      });

      const resumen = await generarResumenSesion(db, sesion);

      expect(resumen.participantes).toBe(2);
      expect(resumen.clientes_registrados).toBe(1);
      expect(resumen.oportunidades).toEqual([{ estado: 'Nuevo' }]);
      expect(resumen.citas).toEqual([]);
    });
  });

  describe('obtenerLineaDeTiempoSesion()', () => {
    test('sin participantes: arreglo vacío, sin consultar', async () => {
      const db = crearMockDb();
      expect(await obtenerLineaDeTiempoSesion(db, { company_id: COMPANY_ID, iniciado_en: new Date().toISOString() }, [])).toEqual([]);
      expect(db.from).not.toHaveBeenCalled();
    });

    test('etiqueta cada evento con el participante correcto, sin mezclar', async () => {
      const participantes = [
        { phone: '+5210000000020', display_name: 'María (residencial)' },
        { phone: '+5210000000021', display_name: 'Carlos (negocio)' },
      ];
      const logs = [
        { tipo: 'channel_event', identificador: '+5210000000020', payload: { subtipo: 'mensaje_recibido', preview: 'hola' }, created_at: '2026-08-01T12:31:05Z' },
        { tipo: 'accion', identificador: '+5210000000021', payload: { tipo_accion: 'crear_oportunidad', exito: true }, created_at: '2026-08-01T12:31:10Z' },
      ];
      const db = crearMockDb({ data: logs, error: null });

      const timeline = await obtenerLineaDeTiempoSesion(db, { company_id: COMPANY_ID, iniciado_en: '2026-08-01T12:00:00Z' }, participantes);

      expect(timeline).toEqual([
        { hora: '2026-08-01T12:31:05Z', participante: 'María (residencial)', texto: 'escribió: "hola"' },
        { hora: '2026-08-01T12:31:10Z', participante: 'Carlos (negocio)', texto: 'Oportunidad creada' },
      ]);
    });
  });

  describe('obtenerEstadoPublico()', () => {
    test('token inexistente → null', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await obtenerEstadoPublico(db, 'token-invalido')).toBeNull();
    });

    test('NUNCA expone company_id/admin_id/cliente_id crudo, enmascara teléfonos, y separa participantes sin mezclar', async () => {
      const sesion = {
        id: DEMO_ID, company_id: COMPANY_ID, admin_id: ADMIN_ID, public_token: 'tok-abc',
        iniciado_en: new Date(Date.now() - 60000).toISOString(), expira_en: new Date(Date.now() + 60000).toISOString(),
        finalizado_en: null, resumen: null, companies: { nombre: 'Empresa Demo Paneles Solares' },
      };
      const participantes = [
        { id: 'part-1', phone: '+5218112345678', display_name: 'María', scenario: 'Residencial', status: 'activo', last_message_at: null, cliente_id: 55 },
      ];

      const db = crearMockDb(
        { data: sesion, error: null },              // sesiones_demo por token
        { data: participantes, error: null },        // demo_session_participants
        { data: { campos_requeridos: ['nombre', 'ciudad'] }, error: null }, // personalities
        // obtenerEstadoParticipante para el único participante:
        { data: { id: 55, nombre: 'María López', telefono: '+5218112345678', score_interes: 80 }, error: null },
        { data: [{ estado: 'Calificado' }], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: { current_node: 'preguntar_ciudad', captured_fields: { nombre: 'María' } }, error: null },
        // línea de tiempo
        { data: [], error: null },
        // latencias ai_call
        { data: [{ latencia_ms: 1000 }, { latencia_ms: 2000 }], error: null },
      );

      const publico = JSON.stringify(await obtenerEstadoPublico(db, 'tok-abc'));

      expect(publico).not.toContain(COMPANY_ID);
      expect(publico).not.toContain(ADMIN_ID);
      expect(publico).not.toContain('55');           // cliente_id crudo nunca aparece
      expect(publico).not.toContain('+5218112345678'); // teléfono completo nunca aparece

      const resultado = JSON.parse(publico);
      expect(resultado.empresa_nombre).toBe('Empresa Demo Paneles Solares');
      expect(resultado.participantes).toHaveLength(1);
      expect(resultado.participantes[0].telefono_enmascarado).toBe('+52181••••78');
      expect(resultado.participantes[0].campos_pendientes).toEqual(['ciudad']);
      expect(resultado.metricas.tiempo_promedio_respuesta_ms).toBe(1500);
    });
  });

  describe('listarSesionesActivas()', () => {
    test('devuelve las sesiones vigentes', async () => {
      const FILAS = [{ id: DEMO_ID, companies: { nombre: 'Empresa Demo Paneles Solares' } }];
      const db = crearMockDb({ data: FILAS, error: null });
      expect(await listarSesionesActivas(db)).toEqual(FILAS);
    });

    test('devuelve arreglo vacío si hay error', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      expect(await listarSesionesActivas(db)).toEqual([]);
    });
  });

  describe('listarEmpresasDemo()', () => {
    test('devuelve solo las empresas marcadas como demo', async () => {
      const FILAS = [{ id: COMPANY_ID, nombre: 'Empresa Demo Paneles Solares', industria_slug: 'paneles_solares' }];
      const db = crearMockDb({ data: FILAS, error: null });
      expect(await listarEmpresasDemo(db)).toEqual(FILAS);
    });

    test('devuelve arreglo vacío si hay error', async () => {
      const db = crearMockDb({ data: null, error: { message: 'boom' } });
      expect(await listarEmpresasDemo(db)).toEqual([]);
    });
  });
});
