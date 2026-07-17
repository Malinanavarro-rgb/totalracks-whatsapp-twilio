import { useState } from 'react';
import { api } from '../../lib/api';

// Extraído de Agenda.jsx (Fase 4) sin cambiar su lógica — compartido entre
// la vista clásica y AgendaViva (Motor de Agenda Universal, Fase 1) para no
// perder la función de crear cita manual en ninguna de las dos.
// asesorIdDefault/horaDefault (opcionales): TARA Canvas v3 — al crear una
// cita desde un espacio disponible del lienzo, el modal abre con esa
// técnica/hora ya seleccionadas, en vez de "Automático"/09:00.
export default function NuevaCitaModal({ asesores, clientesExistentes, fechaDefault, asesorIdDefault, horaDefault, onCerrar, onCreada }) {
  const [modoCliente, setModoCliente]   = useState('existente');
  const [clienteId, setClienteId]       = useState('');
  const [nuevoNombre, setNuevoNombre]   = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevaEmpresa, setNuevaEmpresa] = useState('');
  const [nuevasNotas, setNuevasNotas]   = useState('');
  const [asesorId, setAsesorId]         = useState(asesorIdDefault || '');
  const [fecha, setFecha]               = useState(fechaDefault);
  const [hora, setHora]                 = useState(horaDefault || '09:00');
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
