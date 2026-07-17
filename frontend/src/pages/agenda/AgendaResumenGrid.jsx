import { inicioSemanaUTC, inicioMesUTC, finMesUTC, formatearFechaISO } from './rangoFechas';

// Vista semana/mes — resumen ligero, no reemplaza el detalle operativo del
// día (carriles, alertas, recomendaciones): agrupa las citas ya cargadas
// por fecha y muestra solo total de citas + ingreso real (si hay
// precio_cobrado capturado). Clic en un día abre la vista de día completa.
// Compartido entre Agenda.jsx (clásica) y AgendaViva.jsx — el prop `tema`
// solo cambia la clase raíz para que cada una aplique su propia paleta.

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function agregarPorDia(citas) {
  const mapa = new Map();
  for (const c of citas || []) {
    if (c.estado === 'cancelada') continue;
    const diaISO = c.inicio.slice(0, 10);
    if (!mapa.has(diaISO)) mapa.set(diaISO, { total: 0, ingreso: 0, tieneIngreso: false });
    const entrada = mapa.get(diaISO);
    entrada.total += 1;
    if (c.precio_cobrado != null) {
      entrada.ingreso += Number(c.precio_cobrado);
      entrada.tieneIngreso = true;
    }
  }
  return mapa;
}

export default function AgendaResumenGrid({ vista, fechaBase, citas, fechaHoy, tema, onSeleccionarDia }) {
  const porDia = agregarPorDia(citas);

  if (vista === 'semana') {
    const inicio = inicioSemanaUTC(fechaBase);
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicio);
      d.setUTCDate(d.getUTCDate() + i);
      return d;
    });

    return (
      <div className={`agenda-resumen-grid agenda-resumen-grid--semana agenda-resumen-grid--${tema}`}>
        {dias.map((d) => {
          const iso = formatearFechaISO(d);
          const info = porDia.get(iso);
          return (
            <button
              key={iso} type="button"
              className={`agenda-resumen-dia${iso === fechaHoy ? ' agenda-resumen-dia--hoy' : ''}`}
              onClick={() => onSeleccionarDia(iso)}
            >
              <span className="agenda-resumen-dia-nombre">{DIAS_SEMANA[d.getUTCDay()]}</span>
              <span className="agenda-resumen-dia-num">{d.getUTCDate()}</span>
              <span className="agenda-resumen-dia-total">{info ? `${info.total} cita${info.total === 1 ? '' : 's'}` : 'Sin citas'}</span>
              {info?.tieneIngreso && <span className="agenda-resumen-dia-ingreso">${info.ingreso.toLocaleString('es-MX')}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // vista === 'mes': cuadrícula completa (rellenando con días del mes
  // adyacente para alinear semanas) — esos días de relleno se muestran
  // atenuados y sin dato, porque solo se pidieron citas del mes activo.
  const inicioMesD = inicioMesUTC(fechaBase);
  const finMesD = finMesUTC(fechaBase);
  const inicioGrid = new Date(inicioMesD);
  inicioGrid.setUTCDate(inicioGrid.getUTCDate() - inicioMesD.getUTCDay());
  const finGrid = new Date(finMesD);
  finGrid.setUTCDate(finGrid.getUTCDate() + (6 - finMesD.getUTCDay()));
  const totalDias = Math.round((finGrid - inicioGrid) / 86400000) + 1;
  const mesActual = inicioMesD.getUTCMonth();

  return (
    <div className={`agenda-resumen-grid agenda-resumen-grid--mes agenda-resumen-grid--${tema}`}>
      {DIAS_SEMANA.map((n) => <div key={n} className="agenda-resumen-mes-encabezado">{n}</div>)}
      {Array.from({ length: totalDias }, (_, i) => {
        const d = new Date(inicioGrid);
        d.setUTCDate(d.getUTCDate() + i);
        const iso = formatearFechaISO(d);
        const info = porDia.get(iso);
        const fueraDeMes = d.getUTCMonth() !== mesActual;
        return (
          <button
            key={iso} type="button"
            className={`agenda-resumen-dia agenda-resumen-dia--mes${iso === fechaHoy ? ' agenda-resumen-dia--hoy' : ''}${fueraDeMes ? ' agenda-resumen-dia--fuera' : ''}`}
            onClick={() => onSeleccionarDia(iso)}
          >
            <span className="agenda-resumen-dia-num">{d.getUTCDate()}</span>
            {info && <span className="agenda-resumen-dia-total">{info.total}</span>}
          </button>
        );
      })}
    </div>
  );
}
