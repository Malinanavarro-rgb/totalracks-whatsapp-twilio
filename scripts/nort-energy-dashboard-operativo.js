/**
 * TARA Matrix™ — Nort Energy, dashboard operativo (Alina, 2026-09-29)
 * ─────────────────────────────────────────────────────────────────────────────
 * P1.3 de NORT_ENERGY_AUDIT_V1.md — agrega `kpis_operativos` y `atencion` al
 * `dashboard_kpis_seed` YA existente de Nort Energy (nort-energy-fase1-nav-dashboard.js)
 * SIN tocar `kpis`/`recomendaciones`/`panel_ventas`/`actividad_reciente`
 * (lo comercial sigue exactamente igual — read-modify-write real, nunca overwrite).
 *
 * Deliberadamente NO incluye un KPI de "inventario crítico/faltante": no
 * existe ninguna columna de stock mínimo en `productos` hoy — inventarlo
 * sería precisamente lo que la auditoría pidió NO hacer ("no inventar
 * métricas si el modelo todavía no permite calcularlas correctamente").
 *
 * Uso: node scripts/nort-energy-dashboard-operativo.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

const KPIS_OPERATIVOS = [
  { tipo: 'conteo_proyectos_activos', etiqueta: 'Proyectos activos' },
  { tipo: 'conteo_instalaciones_atrasadas', etiqueta: 'Proyectos/instalaciones atrasados' },
  { tipo: 'suma_saldo_pendiente_cobranza', params: { formato: 'moneda' }, etiqueta: 'Saldo pendiente de cobro' },
  { tipo: 'conteo_proyectos_con_saldo', etiqueta: 'Proyectos con saldo pendiente' },
  { tipo: 'conteo_instalaciones_proximas', params: { dias: 7 }, etiqueta: 'Instalaciones esta semana' },
  { tipo: 'conteo_instalaciones_proximas', params: { dias: 30 }, etiqueta: 'Instalaciones próximas (30 días)' },
  { tipo: 'conteo_tramites_cfe_abiertos', etiqueta: 'Trámites CFE abiertos' },
  { tipo: 'conteo_tramites_cfe_sin_actualizacion', etiqueta: 'Trámites CFE sin actualización' },
  { tipo: 'conteo_garantias_vigentes', etiqueta: 'Garantías vigentes' },
  { tipo: 'conteo_mantenimientos_proximos', etiqueta: 'Mantenimientos próximos' },
  { tipo: 'conteo_mantenimientos_vencidos', etiqueta: 'Mantenimientos vencidos' },
  { tipo: 'conteo_tickets_abiertos', etiqueta: 'Tickets abiertos' },
  { tipo: 'conteo_tickets_urgentes', etiqueta: 'Tickets urgentes' },
];

const ATENCION = [
  { tipo: 'instalacion_atrasada', params: { severidad: 'critica', limite: 10 } },
  { tipo: 'cobranza_con_saldo', params: { severidad: 'warning', limite: 10 } },
  { tipo: 'tramite_cfe_sin_actualizacion', params: { severidad: 'warning', limite: 10 } },
  { tipo: 'garantia_reclamacion_abierta', params: { severidad: 'warning', limite: 10 } },
  { tipo: 'ticket_pendiente', params: { severidad: 'info', limite: 10 } },
];

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) {
    console.error('❌ Error leyendo Nort Energy:', errLeer.message);
    process.exit(1);
  }

  const seedActual = company?.nav_labels?.dashboard_kpis_seed || {};
  const navLabels = {
    ...(company?.nav_labels || {}),
    dashboard_kpis_seed: { ...seedActual, kpis_operativos: KPIS_OPERATIVOS, atencion: ATENCION },
  };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — dashboard operativo configurado: ${KPIS_OPERATIVOS.length} KPIs operativos + ${ATENCION.length} reglas de atención. kpis/recomendaciones comerciales intactos.`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
