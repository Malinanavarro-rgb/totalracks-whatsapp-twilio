import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Página pública — sin sesión. Mismo flujo final que tendrá cuando se
// integre un proveedor de correo: solo cambiará cómo llega el link, no
// esta pantalla ni el endpoint que la respalda.
export default function AceptarInvitacion() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { rehidratar } = useAuth();

  const [invitacion, setInvitacion] = useState(null);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.obtenerInvitacion(token).then(setInvitacion).catch((e) => setError(e.message));
  }, [token]);

  async function aceptar(e) {
    e.preventDefault();
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await api.aceptarInvitacion(token, password);
      await rehidratar();
      navigate('/operaciones');
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  if (error && !invitacion) {
    return (
      <div className="login-pantalla">
        <div className="login-tarjeta"><p className="login-error">{error}</p></div>
      </div>
    );
  }

  if (!invitacion) {
    return <div className="login-pantalla"><p className="operaciones-nota">Cargando…</p></div>;
  }

  return (
    <div className="login-pantalla">
      <form className="login-tarjeta" onSubmit={aceptar}>
        <h1>Únete a {invitacion.empresa}</h1>
        <p className="login-subtitulo">{invitacion.nombre} — {invitacion.email}</p>

        <label>Crea tu contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />

        <label>Confirma tu contraseña</label>
        <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required minLength={6} />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={enviando}>{enviando ? 'Creando cuenta…' : 'Crear cuenta y entrar'}</button>
      </form>
    </div>
  );
}
