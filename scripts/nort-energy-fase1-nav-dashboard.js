/**
 * TARA Matrix™ — Nort Energy Operations, Fase 1 (Alina, 2026-09-09)
 * ─────────────────────────────────────────────────────────────────────────────
 * Configura companies.nav_labels EXCLUSIVAMENTE para Nort Energy (aislado por
 * company_id — no toca plantillas_industria, así que GONDOR y Empresa Demo
 * Paneles Solares, que comparten industria_slug='paneles_solares', siguen
 * recibiendo la plantilla compartida sin ningún cambio):
 *
 *   - modulos: navegación agrupada (Dashboard | VENTAS | OPERACIONES |
 *     ADMINISTRACIÓN | POSTVENTA | ANÁLISIS | SISTEMA). Los módulos de fases
 *     futuras (Instalaciones, Trámites CFE, Cobranza, Inventario, Garantías,
 *     Tickets, Reportes) quedan habilitado:false — Shell.jsx ya renderiza
 *     ese estado como <span> deshabilitado, nunca como <NavLink>, así que no
 *     generan rutas falsas ni errores (mismo mecanismo que ya usaba
 *     "Reportes" en el menú genérico).
 *   - dashboard: layout 'operaciones_dos_niveles' (nuevo, aditivo en
 *     Operaciones.jsx) — ejecutivo arriba / operativo abajo.
 *   - dashboard_kpis_seed: override específico de Nort Energy (nuevo
 *     mecanismo en modules/plantillas-industria.js::obtenerPlantillaDeEmpresa)
 *     con los 10 KPIs prioritarios pedidos + recomendaciones operativas,
 *     usando solo datos reales (clientes, oportunidades, cotizaciones,
 *     citas, tareas) — ningún dato inventado.
 *
 * Read-modify-write sobre nav_labels (nunca overwrite ciego) por si algo más
 * ya le hubiera escrito algo antes de correr este script.
 *
 * Uso: node scripts/nort-energy-fase1-nav-dashboard.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

// Nombres de etapa reales de pipeline_etapas de Nort Energy (confirmados por
// consulta directa, 2026-09-09): Nuevo, Calificado, Visita agendada,
// Cotización enviada, Cerrado, Perdido. Se usan tal cual como DATA en los
// params de cada KPI/recomendación — cero strings de negocio en el código
// del motor (dashboard-engine.js sigue sin ningún "if" de industria).
const ESTADOS_CERRADOS = ['Cerrado', 'Perdido'];

const MODULOS = [
  { ruta: '/operaciones', etiqueta: 'Dashboard', icono: 'inicio', habilitado: true },

  { ruta: '/crm/pipeline', etiqueta: 'Pipeline', icono: 'ventas', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/crm', etiqueta: 'Clientes', icono: 'clientes', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/cotizaciones', etiqueta: 'Cotizaciones', icono: 'cotizaciones', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/paquetes', etiqueta: 'Paquetes', icono: 'catalogo', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/catalogo', etiqueta: 'Catálogo', icono: 'catalogo', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones', icono: 'conversaciones', habilitado: true, grupo: 'VENTAS' },
  { ruta: '/inbox', etiqueta: 'Inbox', icono: 'inbox', habilitado: true, grupo: 'VENTAS' },

  { ruta: '/agenda', etiqueta: 'Agenda', icono: 'agenda', habilitado: true, grupo: 'OPERACIONES' },
  { ruta: '/instalaciones', etiqueta: 'Instalaciones', icono: 'catalogo', habilitado: false, grupo: 'OPERACIONES' },
  { ruta: '/tramites-cfe', etiqueta: 'Trámites CFE', icono: 'configuracion', habilitado: false, grupo: 'OPERACIONES' },

  { ruta: '/cobranza', etiqueta: 'Cobranza', icono: 'cotizaciones', habilitado: false, grupo: 'ADMINISTRACIÓN' },
  { ruta: '/inventario', etiqueta: 'Inventario', icono: 'catalogo', habilitado: false, grupo: 'ADMINISTRACIÓN' },

  { ruta: '/garantias', etiqueta: 'Garantías y mantenimiento', icono: 'configuracion', habilitado: false, grupo: 'POSTVENTA' },
  { ruta: '/tickets', etiqueta: 'Tickets', icono: 'inbox', habilitado: false, grupo: 'POSTVENTA' },

  { ruta: '/reportes', etiqueta: 'Reportes', icono: 'catalogo', habilitado: false, grupo: 'ANÁLISIS' },
  { ruta: '/panel-accion', etiqueta: 'Panel de Acción', icono: 'panelAccion', habilitado: true, soloGerencial: true, grupo: 'ANÁLISIS' },

  { ruta: '/configuracion', etiqueta: 'Configuración', icono: 'configuracion', habilitado: true, grupo: 'SISTEMA' },
];

const DASHBOARD = {
  layout: 'operaciones_dos_niveles',
  preguntasSugeridas: [
    '¿Qué visitas técnicas tengo hoy?',
    '¿Qué cotizaciones llevan más de 72 horas sin respuesta?',
    '¿Cuántos prospectos nuevos tengo esta semana?',
    '¿Qué visitas debo confirmar?',
  ],
};

const DASHBOARD_KPIS_SEED = {
  kpis: [
    { tipo: 'conteo_clientes_nuevos', params: { dias: 30 }, etiqueta: 'Leads nuevos (30 días)' },
    { tipo: 'conteo_oportunidades_excluyendo_estado', params: { estados_excluidos: ESTADOS_CERRADOS }, etiqueta: 'Oportunidades activas' },
    { tipo: 'conteo_cotizaciones_por_estado', params: { desde: 'mes' }, etiqueta: 'Cotizaciones generadas (mes)' },
    { tipo: 'conteo_cotizaciones_por_estado', params: { estado: 'enviada', desde: 'mes' }, etiqueta: 'Cotizaciones enviadas (mes)' },
    { tipo: 'conteo_oportunidades_por_estado_desde', params: { estado: 'Cerrado', desde: 'mes' }, etiqueta: 'Ventas cerradas (mes)' },
    { tipo: 'suma_oportunidades_excluyendo_estado', params: { estados_excluidos: ESTADOS_CERRADOS, campo: 'presupuesto_estimado', formato: 'moneda' }, etiqueta: 'Valor del pipeline' },
    { tipo: 'suma_oportunidades_mes', params: { estado: 'Cerrado', campo: 'presupuesto_confirmado', formato: 'moneda' }, etiqueta: 'Ventas del mes' },
    { tipo: 'conteo_citas_futuras', params: { estados: ['agendada', 'confirmada'], dias_ventana: 7 }, etiqueta: 'Citas próximas (7 días)' },
    { tipo: 'conteo_tareas_por_estado', params: { estados: ['abierta', 'en_progreso'] }, etiqueta: 'Tareas pendientes' },
    { tipo: 'conteo_oportunidades_seguimiento_vencido', params: { estados_excluidos: ESTADOS_CERRADOS }, etiqueta: 'Seguimientos pendientes' },
    { tipo: 'tasa_conversion_oportunidades', params: { estado_ganado: 'Cerrado', estados_cierre: ESTADOS_CERRADOS }, etiqueta: 'Tasa de conversión' },
  ],
  panel_ventas: true,
  actividad_reciente: true,
  recomendaciones: [
    { tipo: 'cita_sin_confirmar_ventana', params: { horas: 48, severidad: 'critica' } },
    { tipo: 'mensaje_sin_responder', params: { horas: 24, severidad: 'critica' } },
    {
      tipo: 'oportunidad_estancada',
      params: {
        estado: 'Nuevo', horas: 24, severidad: 'critica',
        mensaje: '{cliente} es un lead nuevo sin contactar en más de 24 horas.',
        detalle: 'Lead nuevo pendiente de primer contacto.',
        accion: 'Contactar ahora',
      },
    },
    { tipo: 'oportunidad_seguimiento_vencido', params: { estados_excluidos: ESTADOS_CERRADOS, severidad: 'critica' } },
    {
      tipo: 'oportunidad_estancada',
      params: {
        estado: 'Cotización enviada', horas: 72, severidad: 'critica',
        mensaje: '{cliente} lleva más de 72 horas sin seguimiento tras su cotización.',
        detalle: 'Cotización enviada sin respuesta.',
        accion: 'Dar seguimiento ahora',
      },
    },
    {
      tipo: 'oportunidad_en_estado',
      params: {
        estado: 'Visita agendada', severidad: 'info',
        mensaje: 'Prepara la cotización de {cliente} tras su visita técnica.',
        detalle: 'Visita técnica agendada.',
        accion: 'Ver detalle',
      },
    },
    { tipo: 'tarea_pendiente', params: { estados: ['abierta', 'en_progreso'], severidad: 'info' } },
  ],
};

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) {
    console.error('❌ Error leyendo Nort Energy:', errLeer.message);
    process.exit(1);
  }

  const navLabels = {
    ...(company?.nav_labels || {}),
    modulos: MODULOS,
    dashboard: DASHBOARD,
    dashboard_kpis_seed: DASHBOARD_KPIS_SEED,
  };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Nort Energy Operations — nav_labels configurado (modulos + dashboard + dashboard_kpis_seed).');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
