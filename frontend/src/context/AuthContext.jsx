import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [sesion, setSesion]   = useState(null); // { usuario, empresaActiva, empresas }
  const [cargando, setCargando] = useState(true);

  const rehidratar = useCallback(async () => {
    try {
      const datos = await api.yo();
      setSesion(datos);
    } catch {
      setSesion(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { rehidratar(); }, [rehidratar]);

  const iniciarSesion = useCallback(async (email, password) => {
    const datos = await api.login(email, password);
    setSesion(datos);
    return datos;
  }, []);

  const cerrarSesion = useCallback(async () => {
    await api.logout().catch(() => {});
    setSesion(null);
  }, []);

  return (
    <AuthContext.Provider value={{ sesion, cargando, iniciarSesion, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return contexto;
}
