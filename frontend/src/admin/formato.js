export function formatearMoneda(centavos, { decimales = false } = {}) {
  if (centavos == null) return '—';
  const pesos = centavos / 100;
  return pesos.toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: decimales ? 2 : 0,
    maximumFractionDigits: decimales ? 2 : 0,
  });
}

export function formatearFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const ESTADO_ETIQUETA = {
  trial: 'Trial', active: 'Active', past_due: 'Past due',
  suspended: 'Suspended', cancelled: 'Cancelled', expired: 'Expired',
};

export const ESTADO_CLASE = {
  trial: 'pm-pill--warn', active: 'pm-pill--ok', past_due: 'pm-pill--warn',
  suspended: 'pm-pill--danger', cancelled: 'pm-pill--muted', expired: 'pm-pill--muted',
};
