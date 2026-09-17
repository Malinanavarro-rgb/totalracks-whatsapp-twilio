/**
 * TARA Matrix™ — Nort Energy: catálogo de demostración OSDA + Hoymiles
 * (Alina, 2026-09-14)
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga en `productos` el panel OSDA 710W y el microinversor Hoymiles
 * HMS-2250DW-4T bajo el company_id REAL de Nort Energy, y un paquete
 * comercial de 12 paneles (8.52 kWp) en `paquetes_solares` — son los datos
 * de demostración que corresponden a la propuesta que se está analizando
 * hoy (Alina, brief 2026-09-14), explícitamente autorizados como ejemplo,
 * NO como reemplazo del catálogo multimarca real.
 *
 * IMPORTANTE — arquitectura multimarca (instrucción explícita de Alina):
 * este script NO reemplaza ni desactiva el catálogo Jinko Solar/Growatt/
 * Huawei ya cargado para Nort Energy (scripts/nort-energy-cotizador-
 * setup.js) — ambos coexisten en `productos`/`paquetes_solares`, cada
 * cotización elige su propia combinación panel+inversor vía
 * cotizacion_lineas.producto_id. La plantilla de PDF (modules/
 * cotizacion-pdf.js) lee marca/modelo/specs siempre desde `productos` —
 * cero nombres de marca hardcodeados ahí.
 *
 * Solo agrega `cotizacion_pdf_config.plantilla_visual = 'premium_corporativo'`
 * a companies.nav_labels de Nort Energy (read-modify-write, mismo patrón que
 * scripts/nort-energy-fase1-nav-dashboard.js) — GONDOR y Empresa Demo
 * Paneles Solares (mismo industria_slug) NO se ven afectadas.
 *
 * Garantías: se dejan SIN números inventados donde Alina no confirmó una
 * cifra real (garantía de instalación Nort Energy) — el PDF muestra
 * "Consulta con tu asesor" mientras tanto, mismo criterio que ya usa el
 * resto del sistema (migración 096).
 *
 * Uso: node scripts/nort-energy-catalogo-demo-osda-hoymiles.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

async function upsertProducto(datos) {
  // .eq('modelo', null) NUNCA matchea en PostgREST (traduce a `= null`, que
  // en SQL jamás es verdadero) — hay que usar .is() para NULL. Sin esto,
  // cada re-corrida con modelo:null (como el panel OSDA, que no trae modelo
  // exacto) creaba un producto duplicado en vez de detectarlo como existente.
  let query = supabase
    .from('productos')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .eq('tipo', datos.tipo)
    .eq('marca', datos.marca);
  query = datos.modelo == null ? query.is('modelo', null) : query.eq('modelo', datos.modelo);

  const { data: existente, error: errBuscar } = await query.maybeSingle();
  if (errBuscar) throw new Error(`Buscando producto ${datos.marca} ${datos.modelo}: ${errBuscar.message}`);

  if (existente) {
    console.log(`↷ Ya existe: ${datos.marca} ${datos.modelo} (id ${existente.id}) — sin cambios.`);
    return existente.id;
  }

  const { data: creado, error: errCrear } = await supabase
    .from('productos')
    .insert([{ company_id: COMPANY_ID, ...datos }])
    .select('id')
    .single();
  if (errCrear) throw new Error(`Creando producto ${datos.marca} ${datos.modelo}: ${errCrear.message}`);

  console.log(`✓ Creado: ${datos.marca} ${datos.modelo} (id ${creado.id})`);
  return creado.id;
}

async function main() {
  // ── Panel OSDA 710W ────────────────────────────────────────────────────
  // Specs eléctricas (voc/vmp/isc/imp/coef_temp_voc) NO se capturan aquí:
  // Alina no las confirmó en el brief — quedan pendientes de la ficha
  // técnica real del proveedor. Sin esos campos, el motor de ingeniería
  // marca el cálculo de strings como incompleto (comportamiento esperado,
  // nunca inventa un valor eléctrico) hasta que se agreguen.
  const panelId = await upsertProducto({
    tipo: 'panel_solar',
    marca: 'OSDA',
    modelo: null, // "según ficha técnica" — Alina no dio el modelo exacto, solo la potencia
    sku: null,
    descripcion: 'Panel solar OSDA 710W — datos de demostración para la primera plantilla premium',
    garantia_meses: null,
    precio: null, // precio unitario pendiente — el precio comercial vive en paquetes_solares.precio_contado
    unidad: 'pieza',
    specs: { potencia_wp: 710 },
    activo: true,
  });

  // ── Microinversor Hoymiles HMS-2250DW-4T ────────────────────────────────
  const inversorId = await upsertProducto({
    tipo: 'microinversor',
    marca: 'Hoymiles',
    modelo: 'HMS-2250DW-4T',
    sku: null,
    descripcion: 'Microinversor Hoymiles HMS-2250DW-4T, 4 entradas, con monitoreo',
    garantia_meses: null,
    precio: null,
    unidad: 'pieza',
    specs: { potencia_ac_nominal_kw: 2.25, numero_mppt: 4, monitoreo: true },
    activo: true,
  });

  // ── Paquete comercial: 12 paneles / 8.52 kWp / 3 microinversores ───────
  const { data: paqueteExistente, error: errBuscarPaquete } = await supabase
    .from('paquetes_solares')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .eq('cantidad_paneles', 12)
    .eq('marca_panel', 'OSDA')
    .maybeSingle();
  if (errBuscarPaquete) throw new Error(`Buscando paquete OSDA 12 paneles: ${errBuscarPaquete.message}`);

  // precio_contado es NOT NULL en el esquema (migración 093) — no se puede
  // insertar el paquete sin un precio real. Se pasa por variable de entorno
  // (PRECIO_PAQUETE_OSDA_12) en vez de hardcodear un número aquí, para que
  // nunca quede un precio inventado guardado por accidente en el código.
  const precioContado = process.env.PRECIO_PAQUETE_OSDA_12 ? Number(process.env.PRECIO_PAQUETE_OSDA_12) : null;

  if (paqueteExistente) {
    console.log(`↷ Paquete OSDA 12 paneles ya existe (id ${paqueteExistente.id}) — sin cambios.`);
  } else if (!precioContado) {
    console.log('⏸ Paquete OSDA 12 paneles NO creado — falta el precio real. Vuelve a correr con:');
    console.log('   PRECIO_PAQUETE_OSDA_12=94000 node scripts/nort-energy-catalogo-demo-osda-hoymiles.js');
  } else {
    const { data: paqueteCreado, error: errPaquete } = await supabase
      .from('paquetes_solares')
      .insert([{
        company_id: COMPANY_ID,
        nombre: 'Paquete 12 paneles — OSDA 710W + Hoymiles',
        cantidad_paneles: 12,
        potencia_panel_wp: 710,
        potencia_total_kwp: 8.52,
        marca_panel: 'OSDA',
        modelo_panel: null,
        tipo_inversor: 'microinversor',
        cantidad_inversores: 3,
        marca_inversor: 'Hoymiles',
        modelo_inversor: 'HMS-2250DW-4T',
        entradas_por_inversor: 4,
        componentes_incluidos: ['monitoreo', 'estructura de aluminio', 'instalación', 'material eléctrico', 'trámite ante CFE'],
        garantias: {}, // sin números inventados — pendiente de confirmar con el proveedor
        precio_contado: precioContado,
        activo: true,
      }])
      .select('id')
      .single();
    if (errPaquete) throw new Error(`Creando paquete OSDA 12 paneles: ${errPaquete.message}`);
    console.log(`✓ Paquete creado: OSDA 12 paneles (id ${paqueteCreado.id}) — precio_contado $${precioContado}.`);
  }

  // ── companies.nav_labels.cotizacion_pdf_config — plantilla premium ─────
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) throw new Error(`Leyendo nav_labels de Nort Energy: ${errLeer.message}`);

  const navLabels = {
    ...(company?.nav_labels || {}),
    cotizacion_pdf_config: {
      ...(company?.nav_labels?.cotizacion_pdf_config || {}),
      plantilla_visual: 'premium_corporativo',
    },
  };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) throw new Error(`Escribiendo nav_labels de Nort Energy: ${errEscribir.message}`);

  console.log('✓ companies.nav_labels.cotizacion_pdf_config.plantilla_visual = "premium_corporativo" para Nort Energy.');
  console.log('\nPendiente para producción (no inventado aquí a propósito):');
  console.log('  - companies.logo_url de Nort Energy (subir el logo oficial a Storage y apuntar la URL).');
  console.log('  - precio_contado real del paquete OSDA + garantías reales (panel/inversor/instalación Nort Energy).');
  console.log('  - specs eléctricas completas del panel OSDA (voc/vmp/isc/imp/coef_temp_voc) para validar strings.');
  console.log(`\nIDs creados: panel=${panelId} inversor=${inversorId}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
