// Helpers de fecha compartidos entre Agenda.jsx (clásica) y AgendaViva.jsx
// para las vistas semana/mes. Todo en UTC explícito (Date.UTC / getUTC*)
// para que el cálculo de "qué días caen en esta semana/mes" no dependa de
// la zona horaria del navegador — mismo criterio ya usado en
// modules/agenda-engine/index.js y en Agenda.jsx (día) desde Fase 4.

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function fechaISOaUTC(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatearFechaISO(date) {
  return date.toISOString().slice(0, 10);
}

export function inicioSemanaUTC(fechaISO) {
  const d = fechaISOaUTC(fechaISO);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

export function inicioMesUTC(fechaISO) {
  const d = fechaISOaUTC(fechaISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function finMesUTC(fechaISO) {
  const d = fechaISOaUTC(fechaISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Rango [desde, hasta] (ISO datetime, para api.citas) que cubre la vista actual. */
export function rangoParaVista(vista, fechaISO) {
  if (vista === 'semana') {
    const inicio = inicioSemanaUTC(fechaISO);
    const fin = new Date(inicio);
    fin.setUTCDate(fin.getUTCDate() + 6);
    return { desde: `${formatearFechaISO(inicio)}T00:00:00.000Z`, hasta: `${formatearFechaISO(fin)}T23:59:59.999Z` };
  }
  if (vista === 'mes') {
    const inicio = inicioMesUTC(fechaISO);
    const fin = finMesUTC(fechaISO);
    return { desde: `${formatearFechaISO(inicio)}T00:00:00.000Z`, hasta: `${formatearFechaISO(fin)}T23:59:59.999Z` };
  }
  return { desde: `${fechaISO}T00:00:00.000Z`, hasta: `${fechaISO}T23:59:59.999Z` };
}

/** Mueve la fecha ancla un "paso" hacia adelante/atrás, del tamaño de la vista activa. */
export function desplazarFecha(vista, fechaISO, delta) {
  const d = fechaISOaUTC(fechaISO);
  if (vista === 'semana') d.setUTCDate(d.getUTCDate() + delta * 7);
  else if (vista === 'mes') d.setUTCMonth(d.getUTCMonth() + delta);
  else d.setUTCDate(d.getUTCDate() + delta);
  return formatearFechaISO(d);
}

/** Texto legible del rango visible ("julio 2026", "13–19 jul 2026", "lunes 20 de julio"). */
export function etiquetaRango(vista, fechaISO) {
  const d = fechaISOaUTC(fechaISO);
  if (vista === 'mes') return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (vista === 'semana') {
    const inicio = inicioSemanaUTC(fechaISO);
    const fin = new Date(inicio);
    fin.setUTCDate(fin.getUTCDate() + 6);
    const mismoMes = inicio.getUTCMonth() === fin.getUTCMonth();
    return mismoMes
      ? `${inicio.getUTCDate()}–${fin.getUTCDate()} ${MESES[inicio.getUTCMonth()]} ${inicio.getUTCFullYear()}`
      : `${inicio.getUTCDate()} ${MESES[inicio.getUTCMonth()]} – ${fin.getUTCDate()} ${MESES[fin.getUTCMonth()]} ${fin.getUTCFullYear()}`;
  }
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
