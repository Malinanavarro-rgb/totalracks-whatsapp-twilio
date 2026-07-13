// TARA Matrix™ — avatar por empresa (selector de empresa activa)
// Sin logo cargado (companies.logo_url null), se muestra un avatar con
// iniciales + color estable derivado del nombre — mismo patrón visual que
// Slack/Notion/Discord usan antes de subir un ícono custom.

const PALETA = ['#4a90d9', '#d9954a', '#a04ad9', '#4ad98f', '#d94a6a', '#4ad9c9'];

export function iniciales(nombre) {
  if (!nombre) return '?';
  const palabras = nombre.trim().split(/\s+/).slice(0, 2);
  return palabras.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

export function colorDesdeTexto(texto) {
  const t = texto || '';
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = (hash * 31 + t.charCodeAt(i)) | 0;
  }
  return PALETA[Math.abs(hash) % PALETA.length];
}
