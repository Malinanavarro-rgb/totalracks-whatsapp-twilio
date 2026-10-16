# TARA Module Engine — Fase 3.4, cierre ("Mis solicitudes")

**Fecha:** 2026-10-16
**Estado:** implementado y probado localmente. **Sin desplegar a producción.**

---

## 1. Qué se cerró

La empresa ahora puede consultar sus propias solicitudes de ampliación desde Configuración → Explorar herramientas → sección nueva **"Mis solicitudes"**: módulo solicitado, fecha, estado y resolución (cuando existe). Usa exactamente los 3 estados reales ya existentes en `solicitudes_ampliacion.estado` (`pendiente`/`aprobada`/`rechazada`, migración 131) — no se inventó ningún estado nuevo.

## 2. Cambios

| Archivo | Cambio |
|---|---|
| `modules/solicitudes-ampliacion.js` | `crearSolicitud()`: ahora rechaza (409) si ya existe una solicitud **pendiente** del mismo módulo para esa empresa — nunca duplica. `listarSolicitudes()`: nuevo filtro opcional `companyId`. |
| `server.js` | Nueva ruta `GET /api/config/solicitudes-ampliacion` (`requireAuth, soloGerencial`) — filtra **siempre** por `req.usuario.company_id` de la sesión, nunca por un id que mande el cliente. |
| `frontend/src/lib/api.js` | +`solicitudesAmpliacionEmpresa()`. |
| `frontend/src/pages/configuracion/HerramientasTab.jsx` | +Sección "Mis solicitudes". El botón "Solicitar ampliación" se oculta (muestra "Solicitud enviada") si ya hay una pendiente para ese módulo — evita el error 409 antes de que ocurra. |

Ningún cambio a `planes`, `suscripciones`, `modulos_catalogo` ni a los permisos existentes. No se tocó la migración 131 (la tabla ya existía) — cero migraciones nuevas en este cierre.

## 3. "Notificación" — la infraestructura real que existe, y la alternativa que implementé

Audité el panel buscando algo reusable (badges de "no leído", centro de notificaciones, websockets, polling) — no existe nada de eso en ningún otro lugar del producto (solo hay badges de *estado*, como "pill--success", que no son notificaciones). No hay un mecanismo adecuado que reutilizar.

**Alternativa más simple que implementé:** "Mis solicitudes" siempre se recarga con el estado real de la base de datos cada vez que la empresa abre la pestaña — así que en cuanto Super Admin aprueba o rechaza, la empresa ve el resultado actualizado la próxima vez que entra a Explorar herramientas, sin ningún paso adicional de su parte. Esto satisface "consultar inmediatamente el resultado" sin necesitar un sistema de notificaciones push.

**Lo que NO implementé** (presentado, no construido, para que decidas): un indicador proactivo — por ejemplo, un badge con número en la pestaña "Explorar herramientas" del menú, visible sin necesidad de entrar a esa pantalla. Requeriría una columna nueva (`vista_por_empresa` o similar) + lógica de marcado. Si lo quieres, lo implemento en una fase aparte.

## 4. Seguridad verificada

- **Aislamiento multiempresa:** `GET /api/config/solicitudes-ampliacion` siempre filtra por `req.usuario.company_id` (nunca un parámetro del cliente) — probado explícitamente (`__tests__/solicitudes-ampliacion.test.js`, "AISLAMIENTO MULTIEMPRESA").
- **Empleados sin permisos administrativos:** la ruta de solicitar ampliación (`POST /api/config/modulos/:codigo/solicitar-ampliacion`) sigue gateada por `soloGerencial` (owner/administrador) — **sin cambios**, es el mismo middleware que ya protege `/api/billing/*` en producción desde antes de esta sesión. No se puede probar en aislamiento sin un arnés de pruebas HTTP (este repo no tiene supertest ni pruebas de rutas de `server.js` — confirmado, es la convención ya establecida: todo se prueba a nivel de módulo). Lo verifiqué por lectura directa del código, no por una llamada HTTP real.
- **No duplicar solicitudes pendientes:** backend rechaza con 409 (probado) + frontend oculta el botón para evitar el error antes de que ocurra (no probado automáticamente — es React puro, ver punto 5).

## 5. Validación obligatoria — honesto sobre lo que SÍ y NO se probó

**No tengo acceso a un navegador real en este entorno**, y este repo no tiene ningún arnés de pruebas end-to-end contra la aplicación real (Puppeteer está instalado, pero solo se usa para generar PDFs de cotizaciones, nunca para manejar sesiones/login de la app — confirmado, no hay precedente que reutilizar, y construir uno nuevo con las credenciales reales de producción no me pareció una decisión que debiera tomar sin preguntarte primero). Así que, como pediste explícitamente para este caso: preparé la prueba automatizada equivalente y dejo la validación manual como pendiente real, sin declarar la interfaz probada.

**Prueba automatizada del flujo completo** (`__tests__/solicitudes-ampliacion.test.js`, describe "flujo completo"): simula, con las funciones reales del backend (no mocks de alto nivel, las mismas que usan las rutas HTTP) exactamente la secuencia que pediste:
1. Empresa solicita (`crearSolicitud`) → queda `pendiente`.
2. Super Admin aprueba (`revisarSolicitud`, `aprobar: true`).
3. Empresa vuelve a consultar "Mis solicitudes" (`listarSolicitudes({ companyId })`) → ya ve `estado: 'aprobada'` y la nota de revisión.

**Pendiente real, sin probar:** el flujo completo haciendo clic de verdad en el navegador (crear desde `HerramientasTab.jsx`, aprobar desde `SolicitudesAmpliacion.jsx` en Panel Maestro, releer desde `HerramientasTab.jsx`) — recomiendo que lo hagas tú en local (`npm run dev` + el backend) antes de pedir autorización de despliegue, o que me autorices a preparar una cuenta demo (ya existe infraestructura de Modo Demo en la plataforma) para hacerlo yo mismo sin tocar datos de Nort Energy/Total Racks.

## 6. Pruebas automatizadas — resultado

122/122 suites, 2404/2404 tests (6 nuevos: duplicado 409, filtro por company_id, aislamiento, caso de ampliación general sin chequeo, y el flujo completo de 3 pasos). `npx vite build` del frontend limpio.

## 7. Pendientes reales (sin implementar, para tu decisión)

1. Validación manual en navegador (punto 5).
2. Indicador proactivo tipo badge en el menú (punto 3), si lo quieres.
3. Push de estos commits + despliegue — **no hecho, esperando tu autorización**.

---

Cero despliegue, cero datos de producción modificados en esta entrega — todo el trabajo fue código + pruebas locales.
