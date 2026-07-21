import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RutaProtegida from './components/RutaProtegida';
import Shell from './components/Shell';
import Login from './pages/Login';
import Operaciones from './pages/Operaciones';
import Conversaciones from './pages/Conversaciones';
import ConversacionDetalle from './pages/ConversacionDetalle';
import Agenda from './pages/Agenda';
import Crm from './pages/Crm';
import CrmClienteDetalle from './pages/CrmClienteDetalle';
import CrmPipeline from './pages/CrmPipeline';
import Configuracion from './pages/Configuracion';
import Catalogo from './pages/Catalogo';
import AceptarInvitacion from './pages/AceptarInvitacion';
import Registro from './pages/Registro';
import RecuperarPassword from './pages/RecuperarPassword';
import RestablecerPassword from './pages/RestablecerPassword';
import './App.css';

// Panel Maestro (Plataforma Comercial): árbol completamente aparte, cargado
// solo cuando alguien navega a /admin/* — un usuario normal de empresa
// nunca descarga este bundle. Primer code-splitting real del proyecto.
const AdminApp = lazy(() => import('./admin/AdminApp'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/aceptar-invitacion/:token" element={<AceptarInvitacion />} />
          <Route path="/recuperar-password" element={<RecuperarPassword />} />
          <Route path="/restablecer-password" element={<RestablecerPassword />} />
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<div className="pantalla-cargando">Cargando…</div>}>
                <AdminApp />
              </Suspense>
            }
          />

          <Route
            element={
              <RutaProtegida>
                <Shell />
              </RutaProtegida>
            }
          >
            <Route path="/operaciones" element={<Operaciones />} />
            <Route path="/conversaciones" element={<Conversaciones />} />
            <Route path="/conversaciones/:clienteId" element={<ConversacionDetalle />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/crm" element={<Crm />} />
            <Route path="/crm/pipeline" element={<CrmPipeline />} />
            <Route path="/crm/clientes/:clienteId" element={<CrmClienteDetalle />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/catalogo" element={<Catalogo />} />
          </Route>

          <Route path="/" element={<Navigate to="/operaciones" replace />} />
          <Route path="*" element={<Navigate to="/operaciones" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
