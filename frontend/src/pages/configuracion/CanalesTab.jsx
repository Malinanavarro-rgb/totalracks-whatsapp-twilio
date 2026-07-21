import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

const CAMPOS_META_VACIOS = { whatsappBusinessAccountId: '', phoneNumberId: '', metaBusinessId: '', accessToken: '' };

// Centro de Conexiones (Portal de Cliente) — reemplaza el paso de terminal
// (scripts/conectar-empresa-meta.js) por este formulario. Sigue sin ser
// Embedded Signup real (requiere App Review de Meta): el dueño de la
// empresa saca estos valores de Meta Business Manager a mano y los pega
// aquí — pero ya no depende de que Alina corra un script por él.
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

        {mostrarFormularioMeta ? (
          <FormularioWhatsAppMeta onConectado={() => { setMostrarFormularioMeta(false); cargar(); }} />
        ) : (
          <button type="button" onClick={() => setMostrarFormularioMeta(true)}>Conectar un número de WhatsApp</button>
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
