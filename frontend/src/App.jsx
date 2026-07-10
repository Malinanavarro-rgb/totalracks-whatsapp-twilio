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
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

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
            <Route path="/crm/clientes/:clienteId" element={<CrmClienteDetalle />} />
          </Route>

          <Route path="/" element={<Navigate to="/operaciones" replace />} />
          <Route path="*" element={<Navigate to="/operaciones" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
