/**
 * TARA Matrix™ — billing-engine/pagos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Historial de pagos/facturas que TARA le cobra a la empresa. Si un
 * proveedor real (Stripe/Mercado Pago/OpenPay) ya trae su propio desglose
 * de impuestos, se pasa explícito; para altas manuales (sin gateway) se
 * calcula IVA México (16%) automáticamente sobre el subtotal.
 *
 * @module modules/billing-engine/pagos
 */

'use strict';

const IVA_TASA_MX = 0.16;

async function registrarPago(supabase, datos) {
  const subtotalCentavos = datos.subtotalCentavos;
  const ivaCentavos = datos.ivaCentavos ?? Math.round(subtotalCentavos * IVA_TASA_MX);
  const totalCentavos = datos.totalCentavos ?? (subtotalCentavos + ivaCentavos);

  const { data, error } = await supabase
    .from('pagos')
    .insert([{
      organization_id: datos.organizationId,
      suscripcion_id: datos.suscripcionId || null,
      proveedor: datos.proveedor,
      proveedor_invoice_id: datos.proveedorInvoiceId || null,
      proveedor_transaccion_id: datos.proveedorTransaccionId || null,
      numero_factura: datos.numeroFactura || null,
      subtotal_centavos: subtotalCentavos,
      iva_centavos: ivaCentavos,
      total_centavos: totalCentavos,
      moneda: datos.moneda || 'MXN',
      estado: datos.estado,
      fecha_emision: datos.fechaEmision || new Date().toISOString(),
      fecha_pago: datos.fechaPago || null,
      factura_pdf_url: datos.facturaPdfUrl || null,
      factura_xml_url: datos.facturaXmlUrl || null,
      descripcion: datos.descripcion || null,
      raw_evento: datos.rawEvento || null,
    }])
    .select()
    .single();

  if (error) throw new Error(`billing-engine.pagos.registrarPago: ${error.message}`);
  return data;
}

async function listarPagos(supabase, organizationId) {
  const { data, error } = await supabase
    .from('pagos')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

module.exports = { registrarPago, listarPagos, IVA_TASA_MX };
