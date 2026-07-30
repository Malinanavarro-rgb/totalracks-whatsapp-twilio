# ADR-015 — Demo Live View: vista pública multi-participante para demostraciones comerciales

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | 30 de julio de 2026 |
| Autora | Alina Navarro |
| Archivos | `migrations/086_demo_session_participants.sql` (nuevo), `modules/plataforma-demo.js`, `server.js`, `frontend/src/admin/pages/DemoEnVivo.jsx`, `frontend/src/demo-live/` (nuevo), `frontend/src/App.jsx` |

---

## Contexto

El Modo Demo (ADR-013) deja que TARA atienda a un prospecto real como si fuera una empresa contratada, pero la única forma de "verlo en vivo" era que Alina entrara al panel real de la empresa demo (impersonación) o al Panel Maestro — ninguno compartible con el prospecto sin exponer navegación, configuración o datos que no son parte de la demo.

Alina pidió una tercera superficie: una URL pública, sin login, de solo lectura — y, en la misma conversación, la amplió para que **una sola sesión demo soporte varios números autorizados simultáneos** (residencial, negocio, soporte), cada uno una conversación completamente independiente, todas visibles en el mismo tablero.

## Decisión

### 1. El aislamiento entre participantes no es código nuevo

Hallazgo central de la investigación previa a programar: dos participantes de la misma empresa demo son, para el resto del sistema, exactamente lo mismo que dos clientes reales distintos de cualquier empresa — `clientes.telefono` único por `company_id` ya garantiza cero mezcla de nombre, oportunidad, cita o datos extraídos. Lo único que hacía falta rediseñar era **quién tiene permiso de activar la empresa demo ahora mismo** (antes: un teléfono por sesión).

### 2. De "un teléfono por sesión" a "N participantes"

`sesiones_demo` pasa a ser el tablero (empresa, ventana de tiempo, `public_token`, `max_participantes` opcional); `demo_session_participants` (nueva) es la lista de teléfonos autorizados, cada uno con su propio `status` (`autorizado`/`activo`/`pausado`/`bloqueado`/`finalizado`). `resolverParticipacionActiva()` reemplaza a `resolverSesionDemoActiva()` en los dos webhooks — mismo punto de inyección ya usado (después de resolver el canal de salida real, antes de invocar a `procesarMensajeEntrante`), cero cambios a `orchestrator.js`.

Pausar/bloquear/finalizar un participante es un `UPDATE` de una sola fila — nunca afecta a los demás ni a la sesión completa.

### 3. Vista pública — resuelta únicamente por token, curada por allowlist

`GET /api/demo-live/:token/estado` (sin `requireAuth`/`requireAdmin`, mismo criterio que `/api/invitaciones/:token`) resuelve TODO a partir del `public_token` — nunca acepta un `company_id`/`session_id` explícito. `obtenerEstadoPublico()` arma la respuesta por **allowlist explícito** (nunca un spread de las filas crudas): jamás expone `company_id`/`admin_id`/`cliente_id`, y los teléfonos siempre van enmascarados (`+52181••••18`).

Reusa, sin duplicar lógica: `obtenerEstadoParticipante()` (antes `obtenerEstadoSesionDemo`, ADR-013) por cada participante, `generarResumenSesion()` para el cierre, y agrega una sola función nueva de agregación — `obtenerLineaDeTiempoSesion()`, que lee `decision_logs` ya existente (sin tabla de eventos nueva) y etiqueta cada entrada con el participante dueño.

### 4. Frontend — árbol completamente aparte

`frontend/src/demo-live/` es un bundle lazy-loaded independiente (confirmado en `vite build`: `DemoLiveApp` separado del bundle principal y del de `AdminApp`), montado en `/demo-live/:token` junto a las rutas públicas ya existentes de `App.jsx` (mismo patrón que `/aceptar-invitacion/:token`) — nunca dentro de `RutaProtegida` ni `RutaPublica` (este último redirige a `/operaciones` si hay sesión, inaceptable para un prospecto sin cuenta). Cliente de API propio (`demoLiveApi.js`), sin reusar `lib/api.js` ni `admin/adminApi.js` — ninguno de los dos aplica aquí, no hay ningún tipo de sesión.

Tratamiento visual deliberadamente distinto al resto del panel (oscuro, tipo presentación) — hoja de estilos propia (`demo-live.css`), cero clases compartidas con `admin.css`/`App.css`.

### 5. Qué no se construyó (honesto, no silencioso)

- **Subdominio `demo.tara-os.com`**: requiere configuración de DNS/Render, decisión de infraestructura fuera de código. Se usa `tara-os.com/demo-live/:token`.
- **Folio/monto de cotización persistido**: sigue pendiente (ADR-013, sección 5) — la sección de "Cotización" en la UI no se rellena con datos inventados.
- **"Typing indicator" real**: no existe un estado "procesando" persistido durante el turno; se aproxima con una heurística cliente (mensaje sin respuesta y <15s de antigüedad).
- **Realtime/WebSockets**: se usa el mismo polling de 4s que ya usa Operaciones/Inbox/CRM/DemoEnVivo — consistente con el riesgo ya documentado de activar Realtime mientras RLS siga deshabilitado.
- **Solicitud de humano / cambio de intención / corrección retroactiva mid-workflow**: fuera de alcance de este ADR — pertenecen al diagnóstico de ADR-014 (interrupciones de workflow), no a esta pieza.

---

## Pendiente de acción manual (Alina)

1. Aplicar `migrations/086_demo_session_participants.sql` en Supabase + `NOTIFY pgrst, 'reload schema';`.

---

## Pruebas

- `__tests__/plataforma-demo.test.js`: reescrita para el modelo multi-participante — `agregarParticipante` (respeta `max_participantes`), `actualizarParticipante` (pausar/bloquear/reactivar/finalizar, `disabled_at`), `limpiarDatosParticipante`, `resolverParticipacionActiva` (autorizado/activo pasan; la query de estados verificada por mutation testing, no solo por el resultado canned del mock), `registrarActividadParticipante`, `obtenerEstadoPublico` (verificado explícitamente que `company_id`/`admin_id`/`cliente_id` NUNCA aparecen en la respuesta serializada, y que los teléfonos quedan enmascarados).
- **Prueba obligatoria de 3 participantes simultáneos** (`Promise.all`, residencial/negocio/visita técnica) contra Supabase de producción: 3 clientes separados sin mezcla, `obtenerEstadoPublico()` los refleja sin cruce, finalizar uno no afecta a los otros dos, finalizar toda la sesión regresa los 3 teléfonos al flujo normal de TARA-OS, ninguna empresa real tocada.
- `npm test`: 1346+ tests en verde. Build de frontend confirmado con bundle de `demo-live` separado.
