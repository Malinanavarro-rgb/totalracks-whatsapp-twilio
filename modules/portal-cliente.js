/**
 * TARA Matrix™ — portal-cliente.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Portal del cliente final (2026-09-25) — acceso sin contraseña por código
 * de un solo uso. Los clientes NO son `usuarios` de TARA (no tienen
 * membresía en usuarios_empresas), así que esto es un sistema de sesión
 * completamente aparte, nunca mezclado con tara_session/tara_company.
 *
 * `enviarCorreo`/`enviarWhatsApp` se reciben por parámetro (mismo patrón ya
 * usado en modules/recordatorios.js con `channelAdapter`) — este módulo no
 * sabe nada de Resend ni de Graph API, y se puede probar sin credenciales
 * reales ni red.
 *
 * Nunca revela si un teléfono/correo pertenece o no a un cliente real
 * (mismo criterio de cualquier flujo de "olvidé mi contraseña" honesto):
 * la respuesta de `solicitarCodigoAcceso` es igual exista o no el cliente.
 *
 * @module modules/portal-cliente
 */

'use strict';

const crypto = require('crypto');

const MINUTOS_VIGENCIA_CODIGO = 10;
const SEGUNDOS_ENTRE_SOLICITUDES = 60;
const INTENTOS_MAXIMOS = 5;
const DIAS_VIGENCIA_SESION = 7;

function _hashCodigo(companyId, clienteId, codigo) {
  return crypto.createHash('sha256').update(`${companyId}:${clienteId}:${codigo}`).digest('hex');
}

function _generarCodigo() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function _buscarClientePorCorreo(supabase, companyId, correo) {
  if (!correo) return null;
  const { data } = await supabase.from('clientes').select('id, nombre, email').eq('company_id', companyId).ilike('email', correo.trim()).maybeSingle();
  return data || null;
}

/**
 * Pide un código nuevo — SIEMPRE responde `{ enviado: true }` exista o no
 * el cliente, para no revelar qué correos están registrados. Solo envía de
 * verdad si el cliente existe. Limita a 1 solicitud cada 60s por cliente
 * para no permitir spamear el correo/WhatsApp de alguien.
 */
async function solicitarCodigoAcceso(supabase, { companyId, correo }, { enviarCorreo }) {
  const cliente = await _buscarClientePorCorreo(supabase, companyId, correo);
  if (!cliente) return { enviado: true };

  const { data: ultimo } = await supabase
    .from('portal_codigos_acceso').select('created_at').eq('company_id', companyId).eq('cliente_id', cliente.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (ultimo && Date.now() - new Date(ultimo.created_at).getTime() < SEGUNDOS_ENTRE_SOLICITUDES * 1000) {
    const err = new Error(`Espera ${SEGUNDOS_ENTRE_SOLICITUDES} segundos antes de pedir otro código.`);
    err.status = 429;
    throw err;
  }

  const codigo = _generarCodigo();
  const expiraEn = new Date(Date.now() + MINUTOS_VIGENCIA_CODIGO * 60 * 1000).toISOString();

  const { error } = await supabase.from('portal_codigos_acceso').insert([{
    company_id: companyId, cliente_id: cliente.id, codigo_hash: _hashCodigo(companyId, cliente.id, codigo),
    canal: 'correo', destino: cliente.email, expira_en: expiraEn,
  }]);
  if (error) throw new Error(`portal-cliente.solicitarCodigoAcceso: ${error.message}`);

  await enviarCorreo({
    destino: cliente.email, nombre: cliente.nombre, codigo, minutosVigencia: MINUTOS_VIGENCIA_CODIGO,
  });

  return { enviado: true };
}

/**
 * Verifica el código y, si es correcto, crea la sesión del portal. Mensaje
 * de error SIEMPRE genérico ("código inválido o expirado") — nunca
 * distingue "no existe el cliente" de "código equivocado" de "ya expiró".
 */
async function verificarCodigoAcceso(supabase, { companyId, correo, codigo }) {
  const errorGenerico = () => { const err = new Error('Código inválido o expirado.'); err.status = 401; return err; };

  const cliente = await _buscarClientePorCorreo(supabase, companyId, correo);
  if (!cliente) throw errorGenerico();

  const { data: fila } = await supabase
    .from('portal_codigos_acceso').select('*').eq('company_id', companyId).eq('cliente_id', cliente.id)
    .is('usado_en', null).gt('expira_en', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!fila) throw errorGenerico();

  if (fila.intentos >= INTENTOS_MAXIMOS) {
    const err = new Error('Demasiados intentos. Solicita un código nuevo.');
    err.status = 429;
    throw err;
  }

  if (fila.codigo_hash !== _hashCodigo(companyId, cliente.id, String(codigo || ''))) {
    await supabase.from('portal_codigos_acceso').update({ intentos: fila.intentos + 1 }).eq('id', fila.id);
    throw errorGenerico();
  }

  await supabase.from('portal_codigos_acceso').update({ usado_en: new Date().toISOString() }).eq('id', fila.id);

  const token = crypto.randomBytes(32).toString('hex');
  const expiraEn = new Date(Date.now() + DIAS_VIGENCIA_SESION * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('portal_sesiones').insert([{ company_id: companyId, cliente_id: cliente.id, token, expira_en: expiraEn }]);
  if (error) throw new Error(`portal-cliente.verificarCodigoAcceso: ${error.message}`);

  return { token, cliente: { id: cliente.id, nombre: cliente.nombre } };
}

/** Valida un token de sesión del portal — null si no existe, expiró o se cerró. */
async function resolverSesionPortal(supabase, token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('portal_sesiones').select('company_id, cliente_id').eq('token', token)
    .is('cerrado_en', null).gt('expira_en', new Date().toISOString()).maybeSingle();
  if (error || !data) return null;
  return { companyId: data.company_id, clienteId: data.cliente_id };
}

async function cerrarSesionPortal(supabase, token) {
  if (!token) return;
  await supabase.from('portal_sesiones').update({ cerrado_en: new Date().toISOString() }).eq('token', token).is('cerrado_en', null);
}

module.exports = { solicitarCodigoAcceso, verificarCodigoAcceso, resolverSesionPortal, cerrarSesionPortal };
