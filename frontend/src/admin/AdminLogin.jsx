import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';

export default function AdminLogin() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [enviando, setEnviando] = useState(false);
  const { iniciarSesion } = useAdminAuth();
  const navigate = useNavigate();

  async function manejarSubmit(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciarSesion(email, password);
      navigate('/admin');
    } catch (e) {
      setError(e.message || 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pm-login-pantalla">
      <form className="pm-login-tarjeta" onSubmit={manejarSubmit}>
        <div className="pm-login-mark">T</div>
        <h1>Panel Maestro</h1>
        <p className="pm-login-sub">Acceso de Super Admin — TARA Matrix</p>

        <label htmlFor="pm-email">Correo</label>
        <input
          id="pm-email" type="email" required autoComplete="username"
          value={email} onChange={e => setEmail(e.target.value)}
        />

        <label htmlFor="pm-password">Contraseña</label>
        <input
          id="pm-password" type="password" required autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)}
        />

        {error && <p className="pm-login-error">{error}</p>}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
