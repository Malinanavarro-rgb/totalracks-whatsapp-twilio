import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

const CAMPOS_META_VACIOS = { whatsappBusinessAccountId: '', phoneNumberId: '', metaBusinessId: '', accessToken: '' };

const SDK_FACEBOOK_URL = 'https://connect.facebook.net/es_LA/sdk.js';

// Embedded Signup (ADR-009) — flujo oficial de Meta: el popup de Facebook
// Login for Business, no un formulario. Requiere que la plataforma tenga
// configurado META_APP_ID + META_LOGIN_CONFIG_ID (ver
// modules/meta-embedded-signup.js) — sin eso, `disponible` viene en false y
// se muestra solo el formulario manual de abajo.
function cargarSdkFacebook(appId) {
  return new Promise((resolve) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = function () {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v19.0' });
      resolve(window.FB);
    };
    if (document.getElementById('facebook-jssdk')) return; // ya se está cargando
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = SDK_FACEBOOK_URL;
    script.async = true;
    document.body.appendChild(script);
  });
}

function BotonEmbeddedSignup({ configId, appId, onConectado }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const datosSignupRef = useRef(null); // waba_id/phone_number_id llegan por postMessage, no por FB.login()

  useEffect(() => {
    function alRecibirMensaje(evento) {
      if (evento.origin !== 'https://www.facebook.com' && evento.origin !== 'https://web.facebook.com') return;
      try {
        const datos = JSON.parse(evento.data);
        if (datos.type === 'WA_EMBEDDED_SIGNUP' && datos.event === 'FINISH') {
          datosSignupRef.current = datos.data; // { waba_id, phone_number_id, business_id }
        }
      } catch {
        // Meta también manda mensajes que no son JSON (otros productos del SDK) — se ignoran.
      }
    }
    window.addEventListener('message', alRecibirMensaje);
    return () => window.removeEventListener('message', alRecibirMensaje);
  }, []);

  async function conectar() {
    setError(null);
    setEnviando(true);
    datosSignupRef.current = null;
    try {
      const FB = await cargarSdkFacebook(appId);
      FB.login((respuesta) => {
        (async () => {
          const code = respuesta?.authResponse?.code;
          const datosSignup = datosSignupRef.current;
          if (!code || !datosSignup?.waba_id || !datosSignup?.phone_number_id) {
            setError('No se completó la conexión con WhatsApp — inténtalo de nuevo.');
            setEnviando(false);
            return;
          }
          try {
            await api.conectarWhatsAppMetaEmbeddedSignup({
              code,
              wabaId: datosSignup.waba_id,
              phoneNumberId: datosSignup.phone_number_id,
              metaBusinessId: datosSignup.business_id,
            });
            onConectado();
          } catch (e) {
            setError(e.message);
          } finally {
            setEnviando(false);
          }
        })();
      }, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { feature: 'whatsapp_embedded_signup', sessionInfoVersion: 2 },
      });
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={conectar} disabled={enviando}>
        {enviando ? 'Conectando…' : 'Conectar WhatsApp con Meta'}
      </button>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

// Formulario manual — se conserva como respaldo para empresas de prueba o
// mientras Embedded Signup no esté disponible (falta configurar la Meta App
// o aprobar App Review, ver ADR-009). El dueño de la empresa saca estos
// valores de Meta Business Manager a mano y los pega aquí.
//
// Facebook/Instagram usan credenciales distintas (Page ID / Instagram
// Business Account ID, no un phone_number_id) y hoy no existe ningún
// adaptador de canal para ellos — construirlo es del mismo tamaño que la
// integración de WhatsApp, así que quedan como "Próximamente" hasta que se
// decida invertir en eso.
function FormularioWhatsAppMeta({ onConectado }) {
  const [form, setForm] = useState(CAMPOS_META_VACIOS);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function conectar(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api.conectarWhatsAppMeta(form);
      setForm(CAMPOS_META_VACIOS);
      onConectado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={conectar} className="config-form-inline">
      <label>WhatsApp Business Account ID</label>
      <input required value={form.whatsappBusinessAccountId} onChange={(e) => setForm(f => ({ ...f, whatsappBusinessAccountId: e.target.value }))} />

      <label>Phone Number ID</label>
      <input required value={form.phoneNumberId} onChange={(e) => setForm(f => ({ ...f, phoneNumberId: e.target.value }))} />

      <label>Meta Business ID (opcional)</label>
      <input value={form.metaBusinessId} onChange={(e) => setForm(f => ({ ...f, metaBusinessId: e.target.value }))} />

      <label>Token de acceso</label>
      <input required type="password" value={form.accessToken} onChange={(e) => setForm(f => ({ ...f, accessToken: e.target.value }))} />

      {error && <p className="login-error">{error}</p>}

      <button type="submit" disabled={enviando}>{enviando ? 'Conectando…' : 'Conectar número'}</button>
      <p className="operaciones-nota">Estos datos se sacan de Meta Business Manager → WhatsApp → API Setup del número que quieras conectar.</p>
    </form>
  );
}

export default function CanalesTab() {
  const { sesion } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarFormularioMeta, setMostrarFormularioMeta] = useState(false);

  function cargar() {
    api.canalesConfig().then(setDatos).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  if (error) return <p className="login-error">{error}</p>;
  if (!datos) return <p className="operaciones-nota">Cargando…</p>;

  return (
    <div>
      <section className="crm-seccion">
        <h2>WhatsApp</h2>
        {datos.canales.length === 0 ? (
          <p className="operaciones-nota">Sin canales configurados.</p>
        ) : (
          <ul className="config-kb-lista">
            {datos.canales.map((c, i) => (
              <li key={i} className="config-kb-item">
                {c.endpoint} <span className={`etiqueta-atencion ${c.activo ? 'etiqueta-atencion--humano' : ''}`}>
                  {c.activo ? 'Activo' : 'Inactivo'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {datos.metaEmbeddedSignup?.disponible && (
          <BotonEmbeddedSignup
            appId={datos.metaEmbeddedSignup.appId}
            configId={datos.metaEmbeddedSignup.configId}
            onConectado={cargar}
          />
        )}

        {mostrarFormularioMeta ? (
          <FormularioWhatsAppMeta onConectado={() => { setMostrarFormularioMeta(false); cargar(); }} />
        ) : (
          <button type="button" onClick={() => setMostrarFormularioMeta(true)}>
            {datos.metaEmbeddedSignup?.disponible ? 'Conectar con otro método (manual)' : 'Conectar un número de WhatsApp'}
          </button>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Facebook e Instagram</h2>
        <p className="operaciones-nota">Próximamente.</p>
      </section>

      <section className="crm-seccion">
        <h2>Correo</h2>
        <p className="operaciones-nota">Próximamente.</p>
      </section>

      <section className="crm-seccion">
        <h2>Google Calendar</h2>
        {datos.googleCalendar.conectado ? (
          <p className="operaciones-nota">Conectado ({datos.googleCalendar.proveedor}) — sincronización activa.</p>
        ) : (
          <>
            <p className="operaciones-nota">No conectado. La agenda de TARA funciona igual sin esta integración.</p>
            <a href={`/oauth/google/iniciar?company_id=${sesion?.empresaActiva?.company_id}`}>
              <button type="button">Conectar Google Calendar</button>
            </a>
          </>
        )}
      </section>
    </div>
  );
}
