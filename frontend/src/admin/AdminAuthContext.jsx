import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { adminApi } from './adminApi';

// Deliberadamente NO importa context/AuthContext.jsx — dos superficies de
// autorización distintas (sesión de tenant vs. Super Admin), nunca se
// mezclan ni comparten estado.
const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [cargando, setCargando] = useState(true);

  const rehidratar = useCallback(async () => {
    try {
      const { admin: a } = await adminApi.yo();
      setAdmin(a);
    } catch {
      setAdmin(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { rehidratar(); }, [rehidratar]);

  const iniciarSesion = useCallback(async (email, password) => {
    const { admin: a } = await adminApi.login(email, password);
    setAdmin(a);
    return a;
  }, []);

  const cerrarSesion = useCallback(async () => {
    await adminApi.logout().catch(() => {});
    setAdmin(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, cargando, iniciarSesion, cerrarSesion, rehidratar }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const contexto = useContext(AdminAuthContext);
  if (!contexto) throw new Error('useAdminAuth debe usarse dentro de <AdminAuthProvider>');
  return contexto;
}
