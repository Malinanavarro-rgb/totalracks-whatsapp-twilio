import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Página pública — Portal de Cliente: registro de una empresa nueva sin
// que Alina intervenga (antes solo existía por invitación o script). El
// "giro" se detecta automáticamente a partir de la descripción del negocio
// (modules/plantillas-industria.js), igual que scripts/crear-empresa.js.
export default function Registro() {
  const navigate = useNavigate();
  const { rehidratar } = useAuth();

  const [form, setForm] = useState({
    nombreNegocio: '', descripcionNegocio: '', nombreUsuario: '', email: '', password: '',
  });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  function actualizar(campo, valor) {
    setForm(f => ({ ...f, [campo]: valor }));
  }

  async function manejarSubmit(e) {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setEnviando(true);
    try {
      await api.registro(form);
      await rehidratar();
      navigate('/onboarding');
    } catch (e2) {
      setError(e2.message || 'No se pudo crear tu cuenta');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-pantalla">
      <form className="login-tarjeta" onSubmit={manejarSubmit}>
        <h1>Crea tu cuenta en TARA</h1>
        <p className="login-subtitulo">Sin invitaciones, sin llamadas — tu negocio queda listo en un minuto.</p>

        <label htmlFor="nombreNegocio">Nombre de tu negocio</label>
        <input
          id="nombreNegocio" type="text" required
          value={form.nombreNegocio} onChange={(e) => actualizar('nombreNegocio', e.target.value)}
        />

        <label htmlFor="descripcionNegocio">Describe tu negocio brevemente</label>
        <input
          id="descripcionNegocio" type="text" placeholder="Ej. Salón de uñas y manicure en Monterrey"
          value={form.descripcionNegocio} onChange={(e) => actualizar('descripcionNegocio', e.target.value)}
        />

        <label htmlFor="nombreUsuario">Tu nombre</label>
        <input
          id="nombreUsuario" type="text"
          value={form.nombreUsuario} onChange={(e) => actualizar('nombreUsuario', e.target.value)}
        />

        <label htmlFor="email">Correo</label>
        <input
          id="email" type="email" required autoComplete="username"
          value={form.email} onChange={(e) => actualizar('email', e.target.value)}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password" type="password" required minLength={8} autoComplete="new-password"
          value={form.password} onChange={(e) => actualizar('password', e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={enviando}>{enviando ? 'Creando tu cuenta…' : 'Crear cuenta'}</button>

        <p className="login-subtitulo">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
      </form>
    </div>
  );
}
