import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatearHora(iso) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Fase 4: vista de agenda por día, agrupada por asesor (simplificación
// aprobada — sin calendario tipo grid). Un solo camino de escritura de citas:
// esta pantalla llama a las mismas rutas /api/agenda/* que reusan
// SchedulingEngine, el mismo motor que usa la conversación de WhatsApp.
export default function Agenda() {
  const [fecha, setFecha] = useState(hoyISO());
  const [citas, setCitas] = useState(null);
  const [asesores, setAsesores] = useState([]);
  const [clientesExistentes, setClientesExistentes] = useState([]);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    api.asesores().then(setAsesores).catch(() => {});
    api.conversaciones().then(setClientesExistentes).catch(() => {});
  }, []);

  useEffect(() => { cargarCitas(); }, [fecha]);

  function cargarCitas() {
    const desde = `${fecha}T00:00:00.000Z`;
    const hasta = `${fecha}T23:59:59.999Z`;
    api.citas(desde, hasta).then(setCitas).catch((e) => setError(e.message));
  }

  async function cancelar(citaId) {
    try {
      await api.cancelarCita(citaId);
      cargarCitas();
    } catch (e) {
      setError(e.message);
    }
  }

  const citasPorAsesor = {};
  (citas || []).forEach((c) => {
    const nombreAsesor = c.asesores?.nombre || 'Sin asignar';
    (citasPorAsesor[nombreAsesor] = citasPorAsesor[nombreAsesor] || []).push(c);
  });

  return (
    <div>
      <h1>Agenda</h1>

      <div className="agenda-controles">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <button onClick={() => setMostrarForm(true)}>Nueva cita</button>
      </div>

      {error && <p className="login-error">{error}</p>}
      {citas === null && <p className="operaciones-nota">Cargando…</p>}
      {citas?.length === 0 && <p className="operaciones-nota">Sin citas este día.</p>}

      {Object.entries(citasPorAsesor).map(([nombreAsesor, lista]) => (
        <div key={nombreAsesor} className="agenda-grupo-asesor">
          <h3>{nombreAsesor}</h3>
          <ul className="agenda-citas-lista">
            {lista.map((cita) => (
              <li key={cita.id} className="agenda-cita-item">
                <span>{formatearHora(cita.inicio)}–{formatearHora(cita.fin)}</span>
                <span>{cita.clientes?.nombre || cita.clientes?.telefono}</span>
                <span className={`agenda-estado agenda-estado--${cita.estado}`}>{cita.estado}</span>
                {cita.estado !== 'cancelada' && (
                  <button onClick={() => cancelar(cita.id)}>Cancelar</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {mostrarForm && (
        <NuevaCitaModal
          asesores={asesores}
          clientesExistentes={clientesExistentes}
          fechaDefault={fecha}
          onCerrar={() => setMostrarForm(false)}
          onCreada={() => { setMostrarForm(false); cargarCitas(); }}
        />
      )}
    </div>
  );
}

function NuevaCitaModal({ asesores, clientesExistentes, fechaDefault, onCerrar, onCreada }) {
  const [modoCliente, setModoCliente]   = useState('existente');
  const [clienteId, setClienteId]       = useState('');
  const [nuevoNombre, setNuevoNombre]   = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevaEmpresa, setNuevaEmpresa] = useState('');
  const [nuevasNotas, setNuevasNotas]   = useState('');
  const [asesorId, setAsesorId]         = useState('');
  const [fecha, setFecha]               = useState(fechaDefault);
  const [hora, setHora]                 = useState('09:00');
  const [duracionMinutos, setDuracionMinutos] = useState(30);
  const [enviando, setEnviando]         = useState(false);
  const [error, setError]               = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      let clienteFinal = clienteId;
      if (modoCliente === 'nuevo') {
        const cliente = await api.crearClienteManual({
          telefono: nuevoTelefono, nombre: nuevoNombre, empresa: nuevaEmpresa, notas: nuevasNotas,
        });
        clienteFinal = cliente.id;
      }
      if (!clienteFinal) throw new Error('Selecciona o crea un cliente');

      const inicio = new Date(`${fecha}T${hora}:00`);
      const fin = new Date(inicio.getTime() + duracionMinutos * 60000);

      await api.crearCita({
        clienteId: clienteFinal,
        asesorId:  asesorId || undefined,
        inicio:    inicio.toISOString(),
        fin:       fin.toISOString(),
      });
      onCreada();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo">
      <form className="modal-tarjeta" onSubmit={guardar}>
        <h2>Nueva cita</h2>

        <div className="modal-tabs">
          <button type="button" className={modoCliente === 'existente' ? 'activo' : ''} onClick={() => setModoCliente('existente')}>
            Cliente existente
          </button>
          <button type="button" className={modoCliente === 'nuevo' ? 'activo' : ''} onClick={() => setModoCliente('nuevo')}>
            Cliente nuevo
          </button>
        </div>

        {modoCliente === 'existente' ? (
          <label>
            Cliente
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {clientesExistentes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre || c.telefono}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>Nombre
              <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} required />
            </label>
            <label>Teléfono
              <input value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} required />
            </label>
            <label>Empresa (opcional)
              <input value={nuevaEmpresa} onChange={(e) => setNuevaEmpresa(e.target.value)} />
            </label>
            <label>Notas (opcional)
              <input value={nuevasNotas} onChange={(e) => setNuevasNotas(e.target.value)} />
            </label>
          </>
        )}

        <label>
          Asesor
          <select value={asesorId} onChange={(e) => setAsesorId(e.target.value)}>
            <option value="">Automático</option>
            {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </label>

        <label>Fecha <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></label>
        <label>Hora <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
        <label>Duración (min)
          <input type="number" min="5" step="5" value={duracionMinutos} onChange={(e) => setDuracionMinutos(Number(e.target.value))} />
        </label>

        {error && <p className="login-error">{error}</p>}

        <div className="modal-acciones">
          <button type="button" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" disabled={enviando}>Guardar</button>
        </div>
      </form>
    </div>
  );
}
