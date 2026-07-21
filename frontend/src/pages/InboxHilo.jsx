import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const INTERVALO_POLLING_MS = 4000; // mismo criterio que Conversaciones — sin infraestructura de websockets todavía

// Inbox Inteligente (v0.4) — Zona 2: conversación completa, con soporte de
// adjuntos (aunque TARA todavía no "ve" el contenido — ver adapters de
// canal) y respuesta manual real, ya funcionando para cualquier proveedor
// (Twilio o Meta — antes "responder" solo servía para Twilio).
export default function InboxHilo() {
  const { hiloId } = useParams();
  const { sesion } = useAuth();
  const [hilo, setHilo] = useState(null);
  const [mensajes, setMensajes] = useState(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef(null);

  useEffect(() => {
    let activo = true;

    function cargar() {
      Promise.all([api.hiloInbox(hiloId), api.mensajesDeHilo(hiloId)])
        .then(([h, msgs]) => {
          if (!activo) return;
          setHilo(h);
          setMensajes(msgs);
        })
        .catch((e) => { if (activo) setError(e.message); });
    }

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_POLLING_MS);
    return () => { activo = false; clearInterval(intervalo); };
  }, [hiloId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  const clienteId = hilo?.clientes?.id;

  async function tomar() {
    try { await api.tomarConversacion(clienteId); setError(null); } catch (e) { setError(e.message); }
  }

  async function regresar() {
    try { await api.regresarATara(clienteId); setError(null); } catch (e) { setError(e.message); }
  }

  async function cambiarEstado(nuevoEstado) {
    try {
      const actualizado = await api.actualizarHilo(hiloId, { estado: nuevoEstado });
      setHilo((h) => ({ ...h, estado: actualizado.estado }));
    } catch (e) { setError(e.message); }
  }

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim() || !clienteId) return;
    setEnviando(true);
    try {
      await api.enviarMensaje(clienteId, texto.trim());
      setTexto('');
      setMensajes(await api.mensajesDeHilo(hiloId));
      setError(null);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  const tomadaPorMi = hilo?.clientes?.atendido_por === 'humano' && hilo?.clientes?.asesor_id === sesion?.usuario?.id;

  return (
    <div>
      <p><Link to="/inbox">← Volver al Inbox</Link></p>
      <h1>{hilo?.clientes?.nombre && hilo.clientes.nombre !== 'Sin nombre' ? hilo.clientes.nombre : (hilo?.clientes?.telefono || 'Conversación')}</h1>

      {hilo && (
        <div className="inbox-badges">
          <span className="inbox-badge inbox-badge--canal">{hilo.canal}</span>
          <span className={`inbox-badge inbox-badge--prioridad-${hilo.prioridad}`}>{hilo.prioridad}</span>
          {clienteId && <Link to={`/crm/clientes/${clienteId}`}>Ver ficha completa →</Link>}
        </div>
      )}

      <div className="conversacion-acciones">
        {hilo?.clientes?.atendido_por === 'ia' && <button onClick={tomar}>Tomar conversación</button>}
        {hilo?.clientes?.atendido_por === 'humano' && <button onClick={regresar}>Regresar a TARA</button>}
        {hilo?.estado !== 'cerrada' && <button onClick={() => cambiarEstado('cerrada')}>Cerrar conversación</button>}
        {hilo?.estado === 'cerrada' && <button onClick={() => cambiarEstado('abierta')}>Reabrir</button>}
      </div>

      {error && <p className="login-error">{error}</p>}

      <div className="historial-mensajes">
        {mensajes === null && <p className="operaciones-nota">Cargando…</p>}
        {mensajes?.map((m) => (
          <div key={m.id} className={`mensaje-burbuja mensaje-burbuja--${m.direccion === 'entrante' ? 'cliente' : (m.remitente_tipo === 'ia' ? 'tara' : m.remitente_tipo)}`}>
            {m.adjunto_url ? (
              <a href={m.adjunto_url} target="_blank" rel="noreferrer" className="mensaje-texto">📎 Ver {m.tipo_contenido}</a>
            ) : (
              <span className="mensaje-texto">{m.tipo_contenido === 'texto' ? m.contenido : `[${m.tipo_contenido}] ${m.contenido || ''}`}</span>
            )}
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {tomadaPorMi ? (
        <form className="mensaje-form" onSubmit={enviar}>
          <input
            type="text" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe una respuesta…" disabled={enviando}
          />
          <button type="submit" disabled={enviando || !texto.trim()}>Enviar</button>
        </form>
      ) : (
        hilo?.clientes?.atendido_por === 'humano' && (
          <p className="operaciones-nota">Esta conversación la está atendiendo otro asesor.</p>
        )
      )}
    </div>
  );
}
