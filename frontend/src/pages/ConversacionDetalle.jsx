import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const INTERVALO_POLLING_MS = 5000;

export default function ConversacionDetalle() {
  const { clienteId } = useParams();
  const { sesion } = useAuth();
  const [historial, setHistorial] = useState(null);
  const [conversacion, setConversacion] = useState(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef(null);

  useEffect(() => {
    let activo = true;

    function cargar() {
      Promise.all([api.historialConversacion(clienteId), api.conversaciones()])
        .then(([hist, lista]) => {
          if (!activo) return;
          setHistorial(hist);
          setConversacion(lista.find((c) => String(c.id) === String(clienteId)) || null);
        })
        .catch((e) => { if (activo) setError(e.message); });
    }

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_POLLING_MS);
    return () => { activo = false; clearInterval(intervalo); };
  }, [clienteId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [historial]);

  async function tomar() {
    try {
      await api.tomarConversacion(clienteId);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function regresar() {
    try {
      await api.regresarATara(clienteId);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.enviarMensaje(clienteId, texto.trim());
      setTexto('');
      const hist = await api.historialConversacion(clienteId);
      setHistorial(hist);
      setError(null);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  const tomadaPorMi = conversacion?.atendido_por === 'humano' && conversacion?.asesor_id === sesion?.usuario?.id;
  const puedeResponder = tomadaPorMi;

  return (
    <div>
      <p><Link to="/conversaciones">&larr; Conversaciones</Link></p>
      <h1>{conversacion?.nombre || conversacion?.telefono || 'Conversación'}</h1>

      <div className="conversacion-acciones">
        {conversacion?.atendido_por === 'ia' && (
          <button onClick={tomar}>Tomar conversación</button>
        )}
        {conversacion?.atendido_por === 'humano' && (
          <button onClick={regresar}>Regresar a TARA</button>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}

      <div className="historial-mensajes">
        {historial === null && <p className="operaciones-nota">Cargando…</p>}
        {historial?.map((m, i) => (
          <div key={i} className={`mensaje-burbuja mensaje-burbuja--${m.de}`}>
            <span className="mensaje-texto">{m.texto}</span>
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {puedeResponder ? (
        <form className="mensaje-form" onSubmit={enviar}>
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe una respuesta…"
            disabled={enviando}
          />
          <button type="submit" disabled={enviando || !texto.trim()}>Enviar</button>
        </form>
      ) : (
        conversacion?.atendido_por === 'humano' && (
          <p className="operaciones-nota">Esta conversación la está atendiendo otro asesor.</p>
        )
      )}
    </div>
  );
}
