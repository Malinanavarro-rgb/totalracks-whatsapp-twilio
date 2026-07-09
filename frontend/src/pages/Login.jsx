import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [enviando, setEnviando] = useState(false);
  const { iniciarSesion } = useAuth();
  const navigate = useNavigate();

  async function manejarSubmit(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciarSesion(email, password);
      navigate('/operaciones');
    } catch (e) {
      setError(e.message || 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-pantalla">
      <form className="login-tarjeta" onSubmit={manejarSubmit}>
        <h1>TARA Matrix™</h1>
        <p className="login-subtitulo">Inicia sesión en tu panel</p>

        <label htmlFor="email">Correo</label>
        <input
          id="email" type="email" required autoComplete="username"
          value={email} onChange={e => setEmail(e.target.value)}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password" type="password" required autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
