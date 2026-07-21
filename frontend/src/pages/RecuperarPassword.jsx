import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Página pública — sin sesión. Respuesta del backend siempre es la misma
// exista o no la cuenta (evita enumeración de emails), así que esta pantalla
// nunca distingue "no existe" de "listo, revisa tu correo".
export default function RecuperarPassword() {
  const [email, setEmail]     = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function manejarSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api.recuperarPassword(email);
    } finally {
      setEnviando(false);
      setEnviado(true);
    }
  }

  return (
    <div className="login-pantalla">
      <div className="login-tarjeta">
        <h1>Recuperar contraseña</h1>

        {enviado ? (
          <p className="login-subtitulo">Si ese correo tiene una cuenta, te enviamos un link para restablecer tu contraseña.</p>
        ) : (
          <form onSubmit={manejarSubmit}>
            <p className="login-subtitulo">Escribe tu correo y te enviamos un link para restablecerla.</p>

            <label htmlFor="email">Correo</label>
            <input
              id="email" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />

            <button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar link'}</button>
          </form>
        )}

        <p className="login-subtitulo"><Link to="/login">Volver a iniciar sesión</Link></p>
      </div>
    </div>
  );
}
