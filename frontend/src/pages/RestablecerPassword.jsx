import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

// Página pública — sin sesión. Supabase manda aquí con el token en el
// FRAGMENTO de la URL (#access_token=...&type=recovery), nunca en query
// string ni en el body de una petición del servidor. Esta pantalla solo lee
// ese fragmento (string plano) y se lo manda a nuestro backend — el frontend
// nunca llama a Supabase directamente (ver modules/auth.js).
function leerAccessTokenDeLaURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('access_token');
}

export default function RestablecerPassword() {
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState(null);
  const [password, setPassword]       = useState('');
  const [confirmar, setConfirmar]     = useState('');
  const [error, setError]             = useState(null);
  const [enviando, setEnviando]       = useState(false);

  useEffect(() => {
    setAccessToken(leerAccessTokenDeLaURL());
  }, []);

  async function manejarSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setEnviando(true);
    try {
      await api.restablecerPassword(accessToken, password);
      navigate('/login');
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  if (!accessToken) {
    return (
      <div className="login-pantalla">
        <div className="login-tarjeta">
          <p className="login-error">Este link no es válido o ya expiró.</p>
          <p className="login-subtitulo"><Link to="/recuperar-password">Solicitar uno nuevo</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <form className="login-tarjeta" onSubmit={manejarSubmit}>
        <h1>Restablecer contraseña</h1>

        <label htmlFor="password">Nueva contraseña</label>
        <input
          id="password" type="password" required minLength={8} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="confirmar">Confirma tu contraseña</label>
        <input
          id="confirmar" type="password" required minLength={8} autoComplete="new-password"
          value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
      </form>
    </div>
  );
}
