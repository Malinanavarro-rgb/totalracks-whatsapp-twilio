import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Fase 6: dos conceptos distintos que comparten forma pero no significado —
// horarios_laborales (disponibilidad para agendar citas, Anexo A) y
// horario_atencion_bot (cuándo TARA responde por WhatsApp, Fase 6). Una
// empresa puede querer que el bot responda 24/7 aunque solo agende citas de
// 9 a 5, o viceversa.
export default function HorariosTab() {
  const [horariosCitas, setHorariosCitas] = useState(null);
  const [horarioBot, setHorarioBot] = useState(null);
  const [error, setError] = useState(null);

  function cargar() {
    api.horariosConfig().then(setHorariosCitas).catch((e) => setError(e.message));
    api.horarioAtencion().then((filas) => {
      const porDia = {};
      filas.forEach((f) => { porDia[f.dia_semana] = f; });
      setHorarioBot(porDia);
    }).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function guardarDiaBot(dia, hora_inicio, hora_fin) {
    try {
      await api.guardarHorarioAtencion({ dia_semana: dia, hora_inicio, hora_fin });
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function quitarDiaBot(id) {
    try {
      await api.eliminarHorarioAtencion(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>Horario de atención del bot</h2>
        <p className="operaciones-nota">
          Días sin horario configurado: TARA responde 24/7 ese día. Configura un horario para que fuera de él, TARA envíe un mensaje de "fuera de horario" en vez de responder con IA.
        </p>
        {horarioBot === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : (
          <table className="config-tabla-horarios">
            <tbody>
              {DIAS.map((nombreDia, dia) => (
                <FilaHorarioBot
                  key={dia}
                  dia={dia}
                  nombreDia={nombreDia}
                  fila={horarioBot[dia]}
                  onGuardar={guardarDiaBot}
                  onQuitar={quitarDiaBot}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="crm-seccion">
        <h2>Horarios de citas (Agenda)</h2>
        <p className="operaciones-nota">Usados por Agenda para calcular disponibilidad — no afectan si TARA responde o no.</p>
        {horariosCitas === null ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : horariosCitas.length === 0 ? (
          <p className="operaciones-nota">Sin horarios configurados todavía.</p>
        ) : (
          <ul className="config-kb-lista">
            {horariosCitas.map((h) => (
              <li key={h.id} className="config-kb-item">
                {DIAS[h.dia_semana]}: {h.hora_inicio}–{h.hora_fin} ({h.zona_horaria})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilaHorarioBot({ dia, nombreDia, fila, onGuardar, onQuitar }) {
  const [inicio, setInicio] = useState(fila?.hora_inicio?.slice(0, 5) || '09:00');
  const [fin, setFin] = useState(fila?.hora_fin?.slice(0, 5) || '19:00');

  return (
    <tr>
      <td>{nombreDia}</td>
      <td><input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} /></td>
      <td><input type="time" value={fin} onChange={(e) => setFin(e.target.value)} /></td>
      <td>
        <button type="button" onClick={() => onGuardar(dia, inicio, fin)}>Guardar</button>
        {fila && <button type="button" onClick={() => onQuitar(fila.id)}>Quitar (24/7)</button>}
      </td>
    </tr>
  );
}
