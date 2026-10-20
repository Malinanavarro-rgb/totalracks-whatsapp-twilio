/**
 * TARA Matrix™ — prueba de integración real
 * ─────────────────────────────────────────────────────────────────────────────
 * Validación final pedida por Alina (2026-10-16) tras la entrega
 * TARA_IDENTIFICACION_CICLO_CARLOS_GONZALEZ_ENTREGA_V1.md: "no quiero
 * únicamente pruebas aisladas del Orchestrator". A diferencia de
 * __tests__/orchestrator.test.js (que mockea WorkflowEngine e
 * identificacion-contacto como dependencias stub), esta prueba usa:
 *
 *   - WorkflowEngine REAL (modules/workflow-engine.js)
 *   - identificacion-contacto REAL (modules/identificacion-contacto.js)
 *   - CRM REAL (modules/crm.js — obtenerOCrearCliente/guardarConversacion/obtenerHistorial)
 *   - Orchestrator REAL (modules/orchestrator.js)
 *   - ContextBuilder/PromptBuilder/AIEngine REALES
 *
 * contra una base de datos en memoria que implementa el mismo contrato que
 * usa el código real (.from().select().eq()...). Lo único sustituido es la
 * llamada a OpenAI (un proveedor con guion fijo, determinista) y la propia
 * transacción SQL — exactamente la frontera de "integración" razonable sin
 * credenciales ni base de datos reales.
 *
 * Los 7 nodos y el workflow sembrados abajo son una copia fiel (mismo id,
 * mismos campos, mismo texto) del workflow real "Cotización directa —
 * ingeniería solar" de Nort Energy (migración 090), leído en vivo y
 * solo-lectura de Supabase el 2026-10-16 para esta prueba — nunca inventado.
 *
 * Alcance deliberado: la ejecución REAL de `ejecutar_motor_ingenieria`
 * (correrCotizacionDesdeWorkflow, con sus propias tablas de productos/
 * irradiación/cálculos) ya tiene su propia suite dedicada e intacta
 * (__tests__/cotizaciones-fase2.test.js) — aquí se usa un ActionRunner espía
 * (igual que en orchestrator.test.js) para observar SI la acción fue
 * autorizada a correr, no para re-probar el motor de ingeniería en sí.
 *
 * @module __tests__/integracion-identificacion-workflow.test
 */

'use strict';

// ── Fake Supabase — builder encadenable genérico sobre tablas en memoria ────

function crearFakeSupabase() {
  const tablas = {};
  let contadorId = 1;

  function from(nombreTabla) {
    if (!tablas[nombreTabla]) tablas[nombreTabla] = [];
    const filtros = [];
    let modoInsert = null;
    let modoUpdate = null;
    let ordenCampo = null;
    let ordenAsc = true;
    let limite = null;

    async function ejecutar() {
      if (modoInsert) {
        return modoInsert.map(fila => {
          const nueva = { id: fila.id ?? `${nombreTabla}-${contadorId++}`, ...fila };
          tablas[nombreTabla].push(nueva);
          return nueva;
        });
      }
      if (modoUpdate) {
        const filas = tablas[nombreTabla].filter(row => filtros.every(f => f(row)));
        filas.forEach(row => Object.assign(row, modoUpdate));
        return filas;
      }
      let filas = tablas[nombreTabla].filter(row => filtros.every(f => f(row)));
      if (ordenCampo) {
        filas = [...filas].sort((a, b) => {
          if (a[ordenCampo] === b[ordenCampo]) return 0;
          return (a[ordenCampo] > b[ordenCampo] ? 1 : -1) * (ordenAsc ? 1 : -1);
        });
      }
      if (limite != null) filas = filas.slice(0, limite);
      return filas;
    }

    const api = {
      select() { return api; },
      eq(campo, valor) { filtros.push(row => row[campo] === valor); return api; },
      in(campo, valores) { filtros.push(row => valores.includes(row[campo])); return api; },
      gte(campo, valor) { filtros.push(row => row[campo] >= valor); return api; },
      order(campo, opts) { ordenCampo = campo; ordenAsc = opts?.ascending !== false; return api; },
      limit(n) { limite = n; return api; },
      insert(filas) { modoInsert = Array.isArray(filas) ? filas : [filas]; return api; },
      update(cambios) { modoUpdate = cambios; return api; },
      async maybeSingle() {
        const r = await ejecutar();
        return { data: r[0] || null, error: null };
      },
      async single() {
        const r = await ejecutar();
        return { data: r[0] || null, error: r[0] ? null : { message: `${nombreTabla}: no encontrado` } };
      },
      then(resolve, reject) {
        return ejecutar().then(data => resolve({ data, error: null }), reject);
      },
    };
    return api;
  }

  return { from, __tablas: tablas };
}

// ── Workflow real "Cotización directa — ingeniería solar" (Nort Energy,
//    leído en vivo de Supabase 2026-10-16, solo lectura) ─────────────────────

const COMPANY_ID = 'company-integracion-test';
const WORKFLOW_ID = 'e2a01519-e312-4d35-86a0-33d852a9becc';

function nodosRealesIngenieriaSolar() {
  return [
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_nombre', es_inicio: true, es_fin: false, pregunta: '¿Con quién tengo el gusto?', campo: 'nombre', es_opcional: false, siguiente_nodo: 'preguntar_ubicacion', acciones: [], modo_respuesta: 'prepend_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_ubicacion', es_inicio: false, es_fin: false, pregunta: '¿En qué ciudad o municipio está la instalación?', campo: 'ubicacion', es_opcional: false, siguiente_nodo: 'preguntar_consumo_kwh', acciones: [], modo_respuesta: 'prepend_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_consumo_kwh', es_inicio: false, es_fin: false, pregunta: '¿Cuántos kWh consumes en promedio al mes?', campo: 'consumo_mensual_kwh', es_opcional: false, siguiente_nodo: 'preguntar_importe_recibo', acciones: [], modo_respuesta: 'replace_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_importe_recibo', es_inicio: false, es_fin: false, pregunta: '¿Cuál es el importe promedio de tu recibo de CFE?', campo: 'importe_promedio_recibo', es_opcional: false, siguiente_nodo: 'preguntar_cobertura', acciones: [], modo_respuesta: 'replace_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_cobertura', es_inicio: false, es_fin: false, pregunta: '¿Qué porcentaje de tu consumo te gustaría cubrir con paneles solares?', campo: 'pct_cobertura_deseado', es_opcional: false, siguiente_nodo: 'preguntar_tipo_alimentacion', acciones: [], modo_respuesta: 'replace_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_tipo_alimentacion', es_inicio: false, es_fin: false, pregunta: '¿Tu instalación eléctrica es monofásica, bifásica o trifásica?', campo: 'tipo_alimentacion', es_opcional: false, siguiente_nodo: 'preguntar_voltaje', acciones: [], modo_respuesta: 'replace_ai' },
    { workflow_id: WORKFLOW_ID, nombre: 'preguntar_voltaje', es_inicio: false, es_fin: true, pregunta: '¿Sabes si tu servicio es 110/127V o 220V?', campo: 'voltaje_sitio', es_opcional: false, siguiente_nodo: null, acciones: [{ tipo: 'ejecutar_motor_ingenieria', parametros: {} }], modo_respuesta: 'replace_ai' },
  ];
}

function workflowReal() {
  return { id: WORKFLOW_ID, company_id: COMPANY_ID, nombre: 'Cotización directa — ingeniería solar', trigger: 'intent', trigger_value: 'solicitud_cotizacion', prioridad: 10, activo: true };
}

// ── Proveedor de IA con guion fijo — determinista, sin llamar a OpenAI ──────

function aiEngineConGuion(guion) {
  let turno = 0;
  return {
    procesar: jest.fn(async () => {
      const salida = guion[Math.min(turno, guion.length - 1)];
      turno++;
      return salida;
    }),
  };
}

function salidaBase(overrides = {}) {
  return {
    respuesta_texto: 'Claro.', categoria_principal: 'Test', datos_extraidos: {}, datos_contacto: null,
    intenciones: ['consulta_general'], sentimiento: 'Neutral', etapa_sugerida: null,
    acciones_propuestas: [], confianza: 0.8, tokens_entrada: 50, tokens_salida: 20,
    modelo_utilizado: 'mock', proveedor_utilizado: 'mock', latencia_ms: 5,
    ...overrides,
  };
}

// ── Setup: módulos reales montados sobre el fake Supabase ───────────────────

function montarOrchestratorReal(fakeDb, { aiEngine, actionRunner }) {
  jest.resetModules();
  jest.doMock('../modules/clients', () => ({ supabaseServicio: fakeDb }));

  const { Orchestrator } = require('../modules/orchestrator');
  const { ContextBuilder } = require('../modules/context-builder');
  const { PromptBuilder } = require('../modules/prompt-builder');
  const { WorkflowEngine } = require('../modules/workflow-engine');
  const { obtenerOCrearCliente, obtenerHistorial, guardarConversacion } = require('../modules/crm');
  const { actualizarIdentificacionAutomatica } = require('../modules/identificacion-contacto');

  const empresaRaw = {
    company: { id: COMPANY_ID, nombre: 'Nort Energy (prueba)' },
    personality: { capacidades: ['crear_oportunidad', 'agendar_cita', 'agendar_cita_con_horario_solicitado', 'ejecutar_motor_ingenieria'] },
    knowledge: [],
  };

  return new Orchestrator({
    contextBuilder: new ContextBuilder(),
    promptBuilder: new PromptBuilder(),
    aiEngine,
    auditLogger: { logAICall: jest.fn(), logChannelEvent: jest.fn(), logError: jest.fn(), logAccion: jest.fn() },
    workflowEngine: new WorkflowEngine(fakeDb),
    obtenerConfigEmpresa: jest.fn().mockResolvedValue(empresaRaw),
    obtenerOCrearCliente,
    obtenerHistorial,
    guardarConversacion,
    actionRunner,
    actualizarIdentificacion: (clienteId, companyId, datos) => actualizarIdentificacionAutomatica(fakeDb, clienteId, companyId, datos),
  });
}

function makeMessage(telefono, content) {
  return { company_id: COMPANY_ID, channel: 'whatsapp', from: telefono, content, raw_metadata: {} };
}

// ═════════════════════════════════════════════════════════════════════════════

describe('Integración real — WhatsApp → Orchestrator → WorkflowEngine → CRM → validación comercial (2026-10-16)', () => {

  test('Identificación en un solo mensaje: "Hola, soy Carlos González y quiero cotizar paneles solares para mi casa"', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();

    const aiEngine = aiEngineConGuion([
      salidaBase({
        respuesta_texto: 'Mucho gusto, Carlos. Con gusto te ayudo a cotizar.',
        datos_extraidos: { nombre: 'Carlos González' }, // permite auto-advance del nodo preguntar_nombre
        datos_contacto: { nombre: 'Carlos González', motivo: 'Cotizar paneles solares para su casa' },
        intenciones: ['solicitud_cotizacion'],
      }),
    ]);
    const actionRunner = { ejecutar: jest.fn() };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const resultado = await orch.procesarMensaje(makeMessage('+5218100000001', 'Hola, soy Carlos González y quiero cotizar paneles solares para mi casa'));

    // Nombre Y motivo quedan persistidos de verdad en la tabla clientes (no un mock).
    const cliente = fakeDb.__tablas.clientes.find(c => c.telefono === '+5218100000001');
    expect(cliente.nombre).toBe('Carlos González');
    expect(cliente.motivo_consulta).toBe('Cotizar paneles solares para su casa');

    // Ninguna pregunta repetida: el nodo preguntar_nombre se saltó (ya vino en
    // el mismo mensaje) — la respuesta avanza al siguiente dato real.
    expect(resultado.respuesta_texto).not.toContain('¿Con quién tengo el gusto?');
    expect(resultado.respuesta_texto).toContain('¿En qué ciudad o municipio está la instalación?');

    // El workflow de verdad avanzó de nodo en la sesión real (no un mock).
    const sesion = fakeDb.__tablas.workflow_sessions[0];
    expect(sesion.current_node).toBe('preguntar_ubicacion');
    expect(sesion.captured_fields.nombre).toBe('Carlos González');

    // NOTA (hallazgo de esta validación, no un defecto de esta corrección):
    // el sistema HOY no tiene ningún campo ni lógica de "tipo de instalación
    // residencial/comercial" — ni en el schema del modelo (prompt-builder.js),
    // ni en el motor de ingeniería, ni en ningún nodo de workflow. "para mi
    // casa" queda como texto libre dentro del motivo_consulta, nunca como un
    // dato estructurado reconocido. No se implementó nada para simular que sí
    // existe — lo marco en el reporte.
  });

  test('Identificación progresiva: reproduce el patrón del incidente original (nombre y ubicación turno a turno) sin repetir preguntas', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218117796550';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Claro, con gusto.', intenciones: ['solicitud_cotizacion'] }),                                   // "hola quiero cotizar paneles"
      salidaBase({ respuesta_texto: 'Mucho gusto, Carlos.', datos_extraidos: { nombre: 'Carlos González' } }),                       // "Carlos González"
      salidaBase({ respuesta_texto: 'Perfecto.', datos_extraidos: { ubicacion: 'Monterrey' } }),                                     // "Monterrey"
      salidaBase({ respuesta_texto: 'Anotado.', datos_extraidos: { consumo_mensual_kwh: '450' },
        datos_consumo_declarado: { valor: 450, unidad: 'kwh', periodo: 'mensual', aproximado: false } }),                            // "450 kWh"
      salidaBase({ respuesta_texto: 'Listo.', datos_extraidos: { importe_promedio_recibo: '1300' },
        datos_consumo_declarado: { valor: 1300, unidad: 'mxn', periodo: 'mensual', aproximado: false } }),                           // "1300 pesos"
      salidaBase({ respuesta_texto: 'Entendido.', datos_extraidos: { pct_cobertura_deseado: '90' } }),                               // "90%"
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { tipo_alimentacion: 'monofasica' } }),                                  // "monofásica"
      salidaBase({ respuesta_texto: 'Va.', datos_extraidos: { voltaje_sitio: '220' } }),                                             // "220V" — completa el workflow, SIN motivo nunca dado
    ]);
    const actionRunner = { ejecutar: jest.fn() };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const mensajes = ['hola quiero cotizar paneles', 'Carlos González', 'Monterrey', '450 kWh', '1300 pesos', '90%', 'monofásica', '220V'];
    const respuestas = [];
    for (const contenido of mensajes) {
      const r = await orch.procesarMensaje(makeMessage(telefono, contenido));
      respuestas.push(r.respuesta_texto);
    }

    // Nunca se repite una pregunta ya contestada (el defecto real del
    // incidente: "¿con quién tengo el gusto?" en loop).
    const vecesPreguntaNombre = respuestas.filter(r => r.includes('¿Con quién tengo el gusto?')).length;
    expect(vecesPreguntaNombre).toBe(1); // solo la primera vez, nunca después de contestada

    // El cliente real en la tabla clientes tiene el nombre correcto.
    const cliente = fakeDb.__tablas.clientes.find(c => c.telefono === telefono);
    expect(cliente.nombre).toBe('Carlos González');

    // El workflow completó sus 7 nodos reales con los datos capturados.
    const sesion = fakeDb.__tablas.workflow_sessions[0];
    expect(sesion.status).toBe('completado');
    expect(sesion.captured_fields).toMatchObject({
      nombre: 'Carlos González', ubicacion: 'Monterrey', consumo_mensual_kwh: '450',
    });

    // Cambio de comportamiento AUTORIZADO (Alina, incidente "Lucía no
    // completa cotización", 2026-10-18; trade-off confirmado 2026-10-20):
    // este workflow fue disparado por la intención comercial explícita
    // "solicitud_cotizacion" — ESE disparo ya cuenta como motivo suficiente
    // (WorkflowEngine.obtenerMotivoImplicito), aunque el cliente nunca haya
    // dicho la palabra "motivo". Antes (Prioridad 3, "Carlos González",
    // 2026-10-16) un motivo faltante bloqueaba SIEMPRE sin excepción — ese
    // trade-off se revisó explícitamente y se aceptó el costo: ya no se
    // vuelve a preguntar algo que el propio workflow ya demuestra.
    expect(actionRunner.ejecutar).toHaveBeenCalledWith(
      { tipo: 'ejecutar_motor_ingenieria', parametros: {} },
      expect.objectContaining({ clienteRaw: expect.objectContaining({ id: cliente.id }) })
    );
    // El motivo NUNCA se persiste como si fuera texto literal del cliente
    // (el fallback es solo para autorizar la acción, no para inventar
    // datos) — motivo_consulta sigue vacío en la tabla clientes.
    expect(cliente.motivo_consulta).toBeFalsy();

    // No reinicio: el workflow sigue "completado" con TODO su progreso
    // técnico intacto — nunca volvió a current_node inicial ni se creó una
    // segunda sesión.
    const sesionesDeEsteCliente = fakeDb.__tablas.workflow_sessions.filter(s => s.cliente_id === cliente.id);
    expect(sesionesDeEsteCliente).toHaveLength(1);
    expect(sesionesDeEsteCliente[0].current_node).toBe('preguntar_voltaje');

    // Última respuesta: como el motor sí se autorizó a correr (actionRunner
    // mock no devuelve ningún resultado reconocible), cae al texto libre
    // normal del modelo para ese turno ("Va.") — nunca vuelve a preguntar
    // nombre ni motivo.
    expect(respuestas[respuestas.length - 1]).toBe('Va.');
  });

  test('Aislamiento multiempresa: 2 clientes con el MISMO teléfono en 2 empresas distintas nunca comparten identificación ni sesión de workflow', async () => {
    const fakeDb = crearFakeSupabase();
    const company2 = 'company-integracion-test-2';
    fakeDb.__tablas.workflows = [workflowReal(), { ...workflowReal(), id: 'wf-empresa-2', company_id: company2 }];
    fakeDb.__tablas.workflow_nodes = [
      ...nodosRealesIngenieriaSolar(),
      ...nodosRealesIngenieriaSolar().map(n => ({ ...n, workflow_id: 'wf-empresa-2' })),
    ];
    const telefonoCompartido = '+5218100000099';

    const aiEngine1 = aiEngineConGuion([salidaBase({ datos_contacto: { nombre: 'Cliente Empresa 1', motivo: 'Cotizar' }, intenciones: ['consulta_general'] })]);
    const orch1 = montarOrchestratorReal(fakeDb, { aiEngine: aiEngine1, actionRunner: { ejecutar: jest.fn() } });
    await orch1.procesarMensaje({ company_id: COMPANY_ID, channel: 'whatsapp', from: telefonoCompartido, content: 'Soy de la empresa 1', raw_metadata: {} });

    const aiEngine2 = aiEngineConGuion([salidaBase({ datos_contacto: { nombre: null, motivo: null }, intenciones: ['consulta_general'] })]);
    const orch2 = montarOrchestratorReal(fakeDb, { aiEngine: aiEngine2, actionRunner: { ejecutar: jest.fn() } });
    const r2 = await orch2.procesarMensaje({ company_id: company2, channel: 'whatsapp', from: telefonoCompartido, content: 'Hola', raw_metadata: {} });

    const clienteEmpresa1 = fakeDb.__tablas.clientes.find(c => c.telefono === telefonoCompartido && c.company_id === COMPANY_ID);
    const clienteEmpresa2 = fakeDb.__tablas.clientes.find(c => c.telefono === telefonoCompartido && c.company_id === company2);

    expect(clienteEmpresa1.nombre).toBe('Cliente Empresa 1');
    expect(clienteEmpresa2.nombre).toBe('Sin nombre'); // la empresa 2 nunca ve el nombre de la empresa 1
    expect(r2.respuesta_texto).not.toContain('Cliente Empresa 1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Incidente real "Lucía no completa cotización" (Alina, 2026-10-18) —
// conversación real de Nort Energy, 18-oct-2026 16:11-16:15 UTC, cliente_id
// 261. Reproduce el patrón exacto y confirma la corrección autorizada
// 2026-10-20 (ver TARA_INCIDENTE_LUCIA_COTIZACION_DIAGNOSTICO_V1.md).
// ═════════════════════════════════════════════════════════════════════════════

describe('Incidente real "Lucía no completa cotización" (2026-10-18)', () => {
  test('Último nodo técnico completado: el motor SÍ corre (motivo implícito del workflow), nunca responde con el saludo genérico', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),                                    // "hola buen dia, quiero una cotizacion"
      salidaBase({ respuesta_texto: 'Entendido.' }),                                                                          // "es para mi casa" (nombre no respondido de verdad — gap conocido, ver test de abajo)
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { ubicacion: 'Ciudad Victoria' } }),                              // "es en cd victoria"
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { consumo_mensual_kwh: '400' },
        datos_consumo_declarado: { valor: 400, unidad: 'kwh', periodo: 'mensual', aproximado: false } }),                     // consumo ya aclarado
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { importe_promedio_recibo: '1800' },
        datos_consumo_declarado: { valor: 1800, unidad: 'mxn', periodo: 'mensual', aproximado: false } }),                    // importe
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { pct_cobertura_deseado: '90' } }),                               // "90"
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { tipo_alimentacion: 'monofasica' } }),                           // "monofasica"
      salidaBase({ respuesta_texto: 'Va.', datos_extraidos: { voltaje_sitio: '220' } }),                                      // "220" — completa el workflow
    ]);
    const actionRunner = { ejecutar: jest.fn() };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const mensajes = ['hola buen dia, quiero una cotizacion', 'es para mi casa', 'es en cd victoria', '3000 mensual (ya aclarado a 400 kwh)', '1800', '90', 'monofasica', '220'];
    let ultima;
    for (const contenido of mensajes) {
      ultima = await orch.procesarMensaje(makeMessage(telefono, contenido));
    }

    expect(actionRunner.ejecutar).toHaveBeenCalledWith(
      { tipo: 'ejecutar_motor_ingenieria', parametros: {} },
      expect.anything()
    );
    expect(ultima.respuesta_texto).not.toMatch(/en qué (te puedo ayudar|puedo ayudarte)/i);

    const sesion = fakeDb.__tablas.workflow_sessions[0];
    expect(sesion.status).toBe('completado');
    expect(sesion.current_node).toBe('preguntar_voltaje');
  });

  test('Consumo ambiguo: "3000 mensual" sin unidad reportada por el modelo → pide aclaración, NUNCA se guarda en silencio (el bug real del incidente)', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),
      salidaBase({ respuesta_texto: 'Entendido.' }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { ubicacion: 'Ciudad Victoria' } }),
      // "3000 mensual" — el modelo extrae el número a datos_extraidos pero
      // NO llena datos_consumo_declarado (reproduce el turno real del
      // incidente, confirmado por captured_fields sin "_fuente").
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { consumo_mensual_kwh: '3000' } }),
    ]);
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner: { ejecutar: jest.fn() } });

    await orch.procesarMensaje(makeMessage(telefono, 'hola buen dia, quiero una cotizacion'));
    await orch.procesarMensaje(makeMessage(telefono, 'es para mi casa'));
    await orch.procesarMensaje(makeMessage(telefono, 'es en cd victoria'));
    const r = await orch.procesarMensaje(makeMessage(telefono, '3000 mensual'));

    expect(r.respuesta_texto).toMatch(/consumo en kWh, o el importe que pagas en pesos/i);

    const sesion = fakeDb.__tablas.workflow_sessions[0];
    expect(sesion.current_node).toBe('preguntar_consumo_kwh'); // NUNCA avanzó con el valor ambiguo
    expect(sesion.captured_fields.consumo_mensual_kwh).toBeUndefined();
  });

  test('Solicitud repetida de cotización tras completar el workflow: no entra en loop del saludo genérico', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { ubicacion: 'Ciudad Victoria' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { consumo_mensual_kwh: '400' }, datos_consumo_declarado: { valor: 400, unidad: 'kwh', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { importe_promedio_recibo: '1800' }, datos_consumo_declarado: { valor: 1800, unidad: 'mxn', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { pct_cobertura_deseado: '90' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { tipo_alimentacion: 'monofasica' } }),
      salidaBase({ respuesta_texto: 'Va.', datos_extraidos: { voltaje_sitio: '220' } }),
      salidaBase({ respuesta_texto: 'Con gusto, ya tengo tus datos.', intenciones: ['solicitud_cotizacion'] }), // "quiero la cotizacion" (repetida)
    ]);
    const actionRunner = { ejecutar: jest.fn() };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const mensajes = ['hola, quiero una cotizacion', 'cd victoria', '400 kwh', '1800', '90', 'monofasica', '220', 'quiero la cotizacion'];
    let ultima;
    for (const contenido of mensajes) ultima = await orch.procesarMensaje(makeMessage(telefono, contenido));

    // El workflow ya estaba completado — tieneSesionCompletadaReciente evita
    // reabrirlo; la repetición cae a conversación libre normal, nunca repite
    // el saludo genérico de "faltan_datos".
    expect(ultima.respuesta_texto).not.toMatch(/en qué (te puedo ayudar|puedo ayudarte)/i);
    const sesionesDeEsteCliente = fakeDb.__tablas.workflow_sessions.filter(s => s.cliente_id === fakeDb.__tablas.clientes.find(c => c.telefono === telefono).id);
    expect(sesionesDeEsteCliente).toHaveLength(1); // nunca se creó una segunda sesión
  });

  test('Ingeniería bloqueada: el motor corrió pero el cálculo quedó bloqueado → la respuesta refleja el estado real, nunca cifras inventadas', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { ubicacion: 'Ciudad Victoria' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { consumo_mensual_kwh: '400' }, datos_consumo_declarado: { valor: 400, unidad: 'kwh', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { importe_promedio_recibo: '1800' }, datos_consumo_declarado: { valor: 1800, unidad: 'mxn', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { pct_cobertura_deseado: '90' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { tipo_alimentacion: 'monofasica' } }),
      salidaBase({ respuesta_texto: 'El modelo nunca debería decir esto: ~10 kWp.', datos_extraidos: { voltaje_sitio: '220' } }),
    ]);
    const actionRunner = { ejecutar: jest.fn().mockResolvedValue({
      estado_calculo: 'bloqueado', motor: 'paneles_solares',
      alertas: [{ tipo: 'area_insuficiente', severidad: 'bloqueo' }],
    }) };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const mensajes = ['hola, quiero una cotizacion', 'cd victoria', '400 kwh', '1800', '90', 'monofasica', '220'];
    let ultima;
    for (const contenido of mensajes) ultima = await orch.procesarMensaje(makeMessage(telefono, contenido));

    expect(actionRunner.ejecutar).toHaveBeenCalled();
    // Prioridad 5 (2026-10-17): el texto libre del modelo NUNCA gobierna
    // cuando el motor ya corrió — aquí usa el texto honesto real del
    // cálculo bloqueado, nunca "~10 kWp" ni ninguna cifra inventada.
    expect(ultima.respuesta_texto).not.toMatch(/kWp/i);
  });

  test('Ingeniería completada: el motor corrió y el cálculo es exitoso → la respuesta usa las cifras REALES del cálculo', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { ubicacion: 'Ciudad Victoria' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { consumo_mensual_kwh: '400' }, datos_consumo_declarado: { valor: 400, unidad: 'kwh', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { importe_promedio_recibo: '1800' }, datos_consumo_declarado: { valor: 1800, unidad: 'mxn', periodo: 'mensual', aproximado: false } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { pct_cobertura_deseado: '90' } }),
      salidaBase({ respuesta_texto: 'Ok.', datos_extraidos: { tipo_alimentacion: 'monofasica' } }),
      salidaBase({ respuesta_texto: 'Debería decir otra cosa.', datos_extraidos: { voltaje_sitio: '220' } }),
    ]);
    const actionRunner = { ejecutar: jest.fn().mockResolvedValue({
      estado_calculo: 'completo', motor: 'paneles_solares',
      resultados: { numero_paneles: { valor: 8 }, potencia_instalada_kwp: 4.4, cobertura_pct: 90 },
    }) };
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner });

    const mensajes = ['hola, quiero una cotizacion', 'cd victoria', '400 kwh', '1800', '90', 'monofasica', '220'];
    let ultima;
    for (const contenido of mensajes) ultima = await orch.procesarMensaje(makeMessage(telefono, contenido));

    expect(ultima.respuesta_texto).toContain('8 paneles');
    expect(ultima.respuesta_texto).toMatch(/4\.4 kWp/);
  });

  test('GAP CONOCIDO, NO CORREGIDO (pendiente de autorización — punto 3 del diagnóstico): el nodo preguntar_nombre acepta cualquier texto no vacío, aunque claramente no sea un nombre', async () => {
    const fakeDb = crearFakeSupabase();
    fakeDb.__tablas.workflows = [workflowReal()];
    fakeDb.__tablas.workflow_nodes = nodosRealesIngenieriaSolar();
    const telefono = '+5218142850036';

    const aiEngine = aiEngineConGuion([
      salidaBase({ respuesta_texto: 'Buen día.', intenciones: ['solicitud_cotizacion'] }),
      salidaBase({ respuesta_texto: 'Ok.' }), // "es para mi casa" — no es un nombre, el modelo tampoco lo extrajo como tal
    ]);
    const orch = montarOrchestratorReal(fakeDb, { aiEngine, actionRunner: { ejecutar: jest.fn() } });

    await orch.procesarMensaje(makeMessage(telefono, 'hola buen dia, quiero una cotizacion'));
    await orch.procesarMensaje(makeMessage(telefono, 'es para mi casa'));

    const sesion = fakeDb.__tablas.workflow_sessions[0];
    // Esto es el gap documentado, no una aserción deseada: el nodo
    // "preguntar_nombre" no valida el formato de la respuesta — captura el
    // texto crudo tal cual. Si en el futuro se autoriza e implementa el
    // punto 3 (validación de nombre), esta prueba debe actualizarse.
    expect(sesion.captured_fields.nombre).toBe('es para mi casa');
  });
});
