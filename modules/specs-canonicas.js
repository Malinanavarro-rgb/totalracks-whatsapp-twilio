/**
 * TARA Matrix™ — specs-canonicas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Puente entre la extracción de fichas técnicas (documentos-proveedor.js, texto
 * libre de un PDF/foto) y lo que el motor de ingeniería solar realmente lee
 * (modules/motores-ingenieria/paneles-solares.js). Hasta 2026-09-19 la
 * extracción devolvía claves libres (`corriente_corta_circuito_a`,
 * `voltaje_en_potencia_max_v`...) que el motor nunca leía — confirmar el
 * borrador dejaba el producto igual de "bloqueado". Este módulo:
 *
 *   1. Define los campos canónicos por tipo de producto (los mismos que el
 *      motor exige — CAMPOS_PANEL_STRING_REQUERIDOS / CAMPOS_INVERSOR_STRING_REQUERIDOS
 *      + los de potencia y red).
 *   2. Traduce sinónimos conocidos a esas claves y limpia unidades a números.
 *   3. Detecta valores físicamente incoherentes (ej. vmp × imp ≠ potencia, que
 *      es la firma de haber leído la columna de OTRO modelo de la serie) —
 *      nunca corrige un valor en silencio, solo advierte.
 *
 * 100% puro (sin DB, sin red) — mismo criterio que motores-ingenieria/.
 *
 * @module modules/specs-canonicas
 */

'use strict';

/** Campos que el motor necesita por tipo de producto, con su unidad de convención. */
const CAMPOS_CANONICOS = {
  panel_solar: [
    { clave: 'potencia_wp', unidad: 'W', descripcion: 'potencia máxima (Pmax) del modelo exacto' },
    { clave: 'voc', unidad: 'V', descripcion: 'voltaje de circuito abierto (Voc)' },
    { clave: 'vmp', unidad: 'V', descripcion: 'voltaje en el punto de máxima potencia (Vmp)' },
    { clave: 'isc', unidad: 'A', descripcion: 'corriente de cortocircuito (Isc)' },
    { clave: 'imp', unidad: 'A', descripcion: 'corriente en el punto de máxima potencia (Imp)' },
    { clave: 'coef_temp_voc', unidad: '%/°C', descripcion: 'coeficiente de temperatura del Voc, con su signo (casi siempre negativo, ej. -0.27)' },
  ],
  inversor: [
    { clave: 'potencia_ac_nominal_kw', unidad: 'kW', descripcion: 'potencia AC nominal de salida' },
    { clave: 'potencia_dc_max_kw', unidad: 'kW', descripcion: 'potencia máxima de entrada DC (max. PV input power)' },
    { clave: 'tipo_red', unidad: null, descripcion: '"monofasica" o "trifasica"' },
    { clave: 'voltaje_salida_v', unidad: 'V', descripcion: 'voltaje AC nominal de salida (el primer valor nominal impreso)' },
    { clave: 'voltaje_max_entrada_v', unidad: 'V', descripcion: 'voltaje DC máximo de entrada' },
    { clave: 'rango_mppt_min_v', unidad: 'V', descripcion: 'límite inferior del rango de voltaje MPPT' },
    { clave: 'rango_mppt_max_v', unidad: 'V', descripcion: 'límite superior del rango de voltaje MPPT' },
    { clave: 'corriente_max_por_mppt_a', unidad: 'A', descripcion: 'corriente MÁXIMA DE ENTRADA por MPPT (max. input current), NO la de cortocircuito' },
    { clave: 'numero_mppt', unidad: null, descripcion: 'número de MPPT (entero)' },
  ],
};

/** Sinónimos que ya devolvió (o podría devolver) la extracción libre → clave canónica. */
const SINONIMOS = {
  panel_solar: {
    potencia_w: 'potencia_wp', potencia_max_w: 'potencia_wp', potencia_nominal_w: 'potencia_wp', pmax_w: 'potencia_wp', pmax: 'potencia_wp',
    voc_v: 'voc', voltaje_circuito_abierto_v: 'voc', voltaje_de_circuito_abierto_v: 'voc',
    vmp_v: 'vmp', voltaje_en_potencia_max_v: 'vmp', voltaje_potencia_max_v: 'vmp', voltaje_punto_maxima_potencia_v: 'vmp',
    isc_a: 'isc', corriente_corta_circuito_a: 'isc', corriente_cortocircuito_a: 'isc', corriente_de_cortocircuito_a: 'isc',
    imp_a: 'imp', corriente_en_potencia_max_a: 'imp', corriente_potencia_max_a: 'imp', corriente_punto_maxima_potencia_a: 'imp',
    coeficiente_temperatura_voc: 'coef_temp_voc', coeficiente_temperatura_voc_pct_por_c: 'coef_temp_voc', coef_temp_voc_pct_por_c: 'coef_temp_voc',
  },
  inversor: {
    potencia_ac_kw: 'potencia_ac_nominal_kw', potencia_nominal_ac_kw: 'potencia_ac_nominal_kw', potencia_salida_ac_nominal_kw: 'potencia_ac_nominal_kw',
    potencia_max_entrada_dc_kw: 'potencia_dc_max_kw', potencia_entrada_max_kw: 'potencia_dc_max_kw',
    tipo_de_red: 'tipo_red', fases: 'tipo_red',
    voltaje_ac_nominal_v: 'voltaje_salida_v', voltaje_nominal_salida_v: 'voltaje_salida_v',
    voltaje_max_dc_v: 'voltaje_max_entrada_v', voltaje_maximo_entrada_v: 'voltaje_max_entrada_v', voltaje_entrada_max_v: 'voltaje_max_entrada_v',
    voltaje_mppt_min_v: 'rango_mppt_min_v', voltaje_mppt_max_v: 'rango_mppt_max_v',
    corriente_max_entrada_por_mppt_a: 'corriente_max_por_mppt_a', corriente_entrada_max_por_mppt_a: 'corriente_max_por_mppt_a',
    cantidad_mppt: 'numero_mppt', numero_de_mppt: 'numero_mppt',
  },
};

/** "-0.23%/°C" | "52,57 V" | 52.57 → número, o null si no hay un número interpretable. */
function _aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const coincidencia = valor.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return coincidencia ? Number(coincidencia[0]) : null;
}

function _normalizarTipoRed(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/tri|3\s*-?\s*(ph|fase)|three/.test(texto)) return 'trifasica';
  if (/mono|1\s*-?\s*(ph|fase)|single|split/.test(texto)) return 'monofasica';
  return null;
}

function _claveNormalizada(clave) {
  return String(clave).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Separa lo extraído en {canonicas, otros}: `canonicas` con las claves del
 * motor (números limpios), `otros` con todo lo demás tal cual (peso,
 * dimensiones, garantías...) — información útil para el humano, que el motor
 * simplemente no lee.
 */
function normalizarSpecsExtraidos(tipo, specsCrudos) {
  const campos = CAMPOS_CANONICOS[tipo];
  if (!campos) return { canonicas: {}, otros: { ...(specsCrudos || {}) }, advertencias: [] };

  const claves = new Set(campos.map((c) => c.clave));
  const sinonimos = SINONIMOS[tipo] || {};
  const canonicas = {};
  const otros = {};
  const advertencias = [];

  for (const [claveOriginal, valor] of Object.entries(specsCrudos || {})) {
    const norm = _claveNormalizada(claveOriginal);
    const claveCanonica = claves.has(norm) ? norm : sinonimos[norm];
    if (!claveCanonica) { otros[claveOriginal] = valor; continue; }
    if (valor === null || valor === undefined || valor === '') continue;
    if (canonicas[claveCanonica] !== undefined) continue; // la primera gana — nunca se pisa en silencio

    if (claveCanonica === 'tipo_red') {
      const tipoRed = _normalizarTipoRed(valor);
      if (tipoRed) canonicas.tipo_red = tipoRed;
      else advertencias.push(`tipo_red "${valor}" no se pudo interpretar como monofasica/trifasica — no se propone.`);
      continue;
    }
    const numero = _aNumero(valor);
    if (numero === null) { advertencias.push(`${claveCanonica} "${valor}" no es un número interpretable — no se propone.`); continue; }
    canonicas[claveCanonica] = numero;
  }

  // El coeficiente de temperatura del Voc de silicio SIEMPRE es negativo. Un valor
  // positivo es la firma clásica de haber perdido el signo al leer el PDF — con el
  // signo mal, la corrección de Voc por frío daría un voltaje MENOR (inseguro).
  if (tipo === 'panel_solar' && canonicas.coef_temp_voc !== undefined && canonicas.coef_temp_voc >= 0) {
    advertencias.push(`coef_temp_voc = ${canonicas.coef_temp_voc} es positivo — el del Voc siempre es negativo; se descarta, confirma el signo en la ficha.`);
    delete canonicas.coef_temp_voc;
  }

  return { canonicas, otros, advertencias };
}

/**
 * Coherencia física entre los valores canónicos. Devuelve advertencias — nunca
 * modifica ni descarta nada (salvo lo que ya hizo normalizarSpecsExtraidos).
 * La más importante: vmp × imp ≈ potencia_wp. En una ficha que cubre varios
 * modelos por columnas, leer la columna vecina rompe exactamente esta igualdad.
 */
function validarCoherencia(tipo, c) {
  const advertencias = [];
  const tiene = (...claves) => claves.every((k) => typeof c[k] === 'number');

  if (tipo === 'panel_solar') {
    if (tiene('vmp', 'imp', 'potencia_wp')) {
      const pmpp = c.vmp * c.imp;
      const desviacion = Math.abs(pmpp - c.potencia_wp) / c.potencia_wp;
      // 1%: Vmp × Imp ES la definición de Pmax, en fichas reales cuadra dentro de ~0.1% (redondeo).
      // Un umbral mayor no atraparía la columna vecina de la serie (605 W vs 615 W = 1.6%).
      if (desviacion > 0.01) {
        advertencias.push(`Vmp × Imp = ${pmpp.toFixed(0)} W no cuadra con potencia_wp = ${c.potencia_wp} W (${(desviacion * 100).toFixed(1)}% de diferencia) — posible columna de otro modelo de la serie.`);
      }
    }
    if (tiene('vmp', 'voc') && c.vmp >= c.voc) advertencias.push(`vmp (${c.vmp}) debe ser menor que voc (${c.voc}).`);
    if (tiene('imp', 'isc') && c.imp >= c.isc) advertencias.push(`imp (${c.imp}) debe ser menor que isc (${c.isc}).`);
  }

  if (tipo === 'inversor') {
    if (tiene('rango_mppt_min_v', 'rango_mppt_max_v') && c.rango_mppt_min_v >= c.rango_mppt_max_v) {
      advertencias.push(`rango_mppt_min_v (${c.rango_mppt_min_v}) debe ser menor que rango_mppt_max_v (${c.rango_mppt_max_v}).`);
    }
    if (tiene('rango_mppt_max_v', 'voltaje_max_entrada_v') && c.rango_mppt_max_v > c.voltaje_max_entrada_v) {
      advertencias.push(`rango_mppt_max_v (${c.rango_mppt_max_v}) no puede exceder voltaje_max_entrada_v (${c.voltaje_max_entrada_v}).`);
    }
    if (tiene('potencia_dc_max_kw', 'potencia_ac_nominal_kw') && c.potencia_dc_max_kw < c.potencia_ac_nominal_kw) {
      advertencias.push(`potencia_dc_max_kw (${c.potencia_dc_max_kw}) es menor que la AC nominal (${c.potencia_ac_nominal_kw}) — revisa unidades (W vs kW).`);
    }
    if (typeof c.numero_mppt === 'number' && (!Number.isInteger(c.numero_mppt) || c.numero_mppt < 1)) {
      advertencias.push(`numero_mppt (${c.numero_mppt}) debe ser un entero ≥ 1.`);
    }
  }

  return advertencias;
}

/** Claves canónicas que todavía no tienen valor en `specs` (lo que el motor aún no puede leer). */
function camposFaltantes(tipo, specs) {
  const campos = CAMPOS_CANONICOS[tipo];
  if (!campos) return [];
  return campos.map((c) => c.clave).filter((k) => specs?.[k] === undefined || specs?.[k] === null);
}

/** Texto para el prompt: la lista de claves canónicas que la IA debe devolver, con unidad. */
function describirCamposParaPrompt(tipo) {
  return (CAMPOS_CANONICOS[tipo] || []).map((c) => `    "${c.clave}": ${c.descripcion}${c.unidad ? ` — en ${c.unidad}` : ''}`).join(',\n');
}

/** Normaliza para comparar nombres de modelo: "LR7-72HTH-615M" ≈ "lr7 72hth 615m". */
function _normalizarModelo(texto) {
  return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * ¿El modelo que la IA dice haber leído es el modelo objetivo? Igual una vez
 * normalizado, o una variante con un sufijo/prefijo corto (≤3 caracteres, ej.
 * "-BF", "-V"). Deliberadamente NO acepta que el nombre de la SERIE ("LR7-72HTH")
 * cuente como coincidencia del modelo completo ("LR7-72HTH-615M") — leer la
 * cabecera de la serie en vez de la columna del modelo es justo el error que
 * este chequeo existe para atrapar.
 */
function modeloCoincide(modeloObjetivo, modeloLeido) {
  const a = _normalizarModelo(modeloObjetivo);
  const b = _normalizarModelo(modeloLeido);
  if (!a || !b) return false;
  if (a === b) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return largo.includes(corto) && largo.length - corto.length <= 3;
}

module.exports = {
  CAMPOS_CANONICOS,
  normalizarSpecsExtraidos,
  validarCoherencia,
  camposFaltantes,
  describirCamposParaPrompt,
  modeloCoincide,
};
