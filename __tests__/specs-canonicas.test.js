'use strict';

const {
  CAMPOS_CANONICOS, normalizarSpecsExtraidos, validarCoherencia, camposFaltantes, describirCamposParaPrompt, modeloCoincide,
} = require('../modules/specs-canonicas');

describe('CAMPOS_CANONICOS', () => {
  test('los campos de panel son exactamente los que el motor exige para validar strings + potencia', () => {
    expect(CAMPOS_CANONICOS.panel_solar.map((c) => c.clave)).toEqual(['potencia_wp', 'voc', 'vmp', 'isc', 'imp', 'coef_temp_voc']);
  });

  test('los campos de inversor cubren los 9 que el motor lee', () => {
    expect(CAMPOS_CANONICOS.inversor.map((c) => c.clave).sort()).toEqual([
      'corriente_max_por_mppt_a', 'numero_mppt', 'potencia_ac_nominal_kw', 'potencia_dc_max_kw', 'rango_mppt_max_v',
      'rango_mppt_min_v', 'tipo_red', 'voltaje_max_entrada_v', 'voltaje_salida_v',
    ]);
  });
});

describe('normalizarSpecsExtraidos()', () => {
  test('traduce los sinónimos que devolvió la extracción libre real (el caso LONGi) a claves del motor', () => {
    const { canonicas, otros } = normalizarSpecsExtraidos('panel_solar', {
      potencia_w: 605, corriente_corta_circuito_a: 14.74, voltaje_en_potencia_max_v: 44.03, corriente_en_potencia_max_a: 13.75,
      coeficiente_temperatura_voc_pct_por_c: -0.23, peso_kg: 28.5,
    });
    expect(canonicas).toEqual({ potencia_wp: 605, isc: 14.74, vmp: 44.03, imp: 13.75, coef_temp_voc: -0.23 });
    expect(otros).toEqual({ peso_kg: 28.5 }); // lo que el motor no lee se conserva para el humano
  });

  test('acepta ya las claves canónicas y limpia números escritos como texto con unidades', () => {
    const { canonicas } = normalizarSpecsExtraidos('panel_solar', { voc: '52,57 V', coef_temp_voc: '-0.23%/°C', potencia_wp: 615 });
    expect(canonicas).toEqual({ voc: 52.57, coef_temp_voc: -0.23, potencia_wp: 615 });
  });

  test('coef_temp_voc POSITIVO se descarta con advertencia (signo perdido = corrección de Voc insegura)', () => {
    const { canonicas, advertencias } = normalizarSpecsExtraidos('panel_solar', { voc: 50, coef_temp_voc: 0.27 });
    expect(canonicas.coef_temp_voc).toBeUndefined();
    expect(canonicas.voc).toBe(50);
    expect(advertencias.join(' ')).toMatch(/positivo/);
  });

  test('valor no numérico → no se propone, con advertencia (nunca se adivina)', () => {
    const { canonicas, advertencias } = normalizarSpecsExtraidos('panel_solar', { voc: 'ver ficha' });
    expect(canonicas).toEqual({});
    expect(advertencias.join(' ')).toMatch(/voc/);
  });

  test('null/vacío se ignoran sin advertencia', () => {
    const { canonicas, advertencias } = normalizarSpecsExtraidos('panel_solar', { voc: null, vmp: '' });
    expect(canonicas).toEqual({});
    expect(advertencias).toEqual([]);
  });

  test('si una clave llega dos veces (canónica + sinónimo), la primera gana — nunca se pisa en silencio', () => {
    const { canonicas } = normalizarSpecsExtraidos('panel_solar', { isc: 14.87, corriente_corta_circuito_a: 14.74 });
    expect(canonicas.isc).toBe(14.87);
  });

  test('inversor: normaliza tipo_red a "monofasica"/"trifasica" (sin acento, como el catálogo existente)', () => {
    expect(normalizarSpecsExtraidos('inversor', { tipo_red: 'Monofásica' }).canonicas.tipo_red).toBe('monofasica');
    expect(normalizarSpecsExtraidos('inversor', { tipo_red: 'Three-phase' }).canonicas.tipo_red).toBe('trifasica');
    expect(normalizarSpecsExtraidos('inversor', { tipo_de_red: '3 fases' }).canonicas.tipo_red).toBe('trifasica');
  });

  test('inversor: tipo_red ininterpretable → no se propone', () => {
    const { canonicas, advertencias } = normalizarSpecsExtraidos('inversor', { tipo_red: 'según instalación' });
    expect(canonicas.tipo_red).toBeUndefined();
    expect(advertencias.length).toBe(1);
  });

  test('tipo sin campos canónicos (ej. bateria) → todo queda en "otros", nada se pierde ni se inventa', () => {
    const { canonicas, otros } = normalizarSpecsExtraidos('bateria', { capacidad_kwh: 5 });
    expect(canonicas).toEqual({});
    expect(otros).toEqual({ capacidad_kwh: 5 });
  });

  test('specs undefined no lanza', () => {
    expect(normalizarSpecsExtraidos('panel_solar', undefined).canonicas).toEqual({});
  });
});

describe('validarCoherencia()', () => {
  const panel615 = { potencia_wp: 615, voc: 52.57, vmp: 44.33, isc: 14.87, imp: 13.88, coef_temp_voc: -0.23 };

  test('panel coherente (LONGi 615 W real) → sin advertencias', () => {
    expect(validarCoherencia('panel_solar', panel615)).toEqual([]);
  });

  test('vmp × imp que no cuadra con la potencia = columna de OTRO modelo → advierte', () => {
    // valores de la columna 605 W con la potencia del 615 W: el error real que motivó esto
    const mezclado = { ...panel615, vmp: 44.03, imp: 13.75 };
    const adv = validarCoherencia('panel_solar', mezclado);
    expect(adv.join(' ')).toMatch(/columna de otro modelo/);
  });

  test('vmp >= voc o imp >= isc → advierte', () => {
    expect(validarCoherencia('panel_solar', { vmp: 55, voc: 50 }).join(' ')).toMatch(/vmp/);
    expect(validarCoherencia('panel_solar', { imp: 15, isc: 14 }).join(' ')).toMatch(/imp/);
  });

  test('panel con campos ausentes → no lanza ni inventa advertencias', () => {
    expect(validarCoherencia('panel_solar', { potencia_wp: 615 })).toEqual([]);
  });

  test('inversor coherente (Growatt MIN 4000TL-X del catálogo) → sin advertencias', () => {
    expect(validarCoherencia('inversor', {
      potencia_ac_nominal_kw: 4, potencia_dc_max_kw: 6, voltaje_max_entrada_v: 500, rango_mppt_min_v: 80, rango_mppt_max_v: 450, numero_mppt: 2,
    })).toEqual([]);
  });

  test('inversor: rango MPPT invertido, MPPT máx > voltaje máx, DC < AC (W vs kW), MPPT no entero', () => {
    expect(validarCoherencia('inversor', { rango_mppt_min_v: 450, rango_mppt_max_v: 80 }).length).toBe(1);
    expect(validarCoherencia('inversor', { rango_mppt_max_v: 600, voltaje_max_entrada_v: 500 }).length).toBe(1);
    expect(validarCoherencia('inversor', { potencia_dc_max_kw: 6, potencia_ac_nominal_kw: 4000 }).join(' ')).toMatch(/W vs kW/);
    expect(validarCoherencia('inversor', { numero_mppt: 2.5 }).length).toBe(1);
  });
});

describe('camposFaltantes()', () => {
  test('lista exactamente lo que el motor todavía no puede leer', () => {
    expect(camposFaltantes('panel_solar', { potencia_wp: 550 })).toEqual(['voc', 'vmp', 'isc', 'imp', 'coef_temp_voc']);
  });

  test('ficha completa → []', () => {
    expect(camposFaltantes('panel_solar', { potencia_wp: 550, voc: 49.5, vmp: 41.7, isc: 14.02, imp: 13.19, coef_temp_voc: -0.27 })).toEqual([]);
  });

  test('un valor 0 cuenta como presente (no es "faltante")', () => {
    expect(camposFaltantes('panel_solar', { potencia_wp: 550, voc: 49.5, vmp: 41.7, isc: 14, imp: 13, coef_temp_voc: 0 })).toEqual([]);
  });

  test('tipo sin campos canónicos → []', () => {
    expect(camposFaltantes('bateria', {})).toEqual([]);
  });
});

describe('describirCamposParaPrompt()', () => {
  test('incluye las claves canónicas con su unidad y la advertencia de corriente de entrada vs cortocircuito', () => {
    expect(describirCamposParaPrompt('panel_solar')).toMatch(/"voc".*V/);
    expect(describirCamposParaPrompt('inversor')).toMatch(/NO la de cortocircuito/);
  });
});

describe('modeloCoincide()', () => {
  test('igual ignorando mayúsculas y separadores', () => {
    expect(modeloCoincide('LR7-72HTH-615M', 'lr7 72hth 615m')).toBe(true);
  });

  test('otro modelo de la MISMA serie (605M vs 615M) NO coincide', () => {
    expect(modeloCoincide('LR7-72HTH-615M', 'LR7-72HTH-605M')).toBe(false);
  });

  test('el nombre de la SERIE no cuenta como el modelo completo', () => {
    expect(modeloCoincide('LR7-72HTH-615M', 'LR7-72HTH')).toBe(false);
  });

  test('variantes con sufijo NO coinciden: MIN 6000TL-X ≠ MIN 6000TL-X2 (specs distintas en un inversor)', () => {
    expect(modeloCoincide('MIN 6000TL-X2', 'MIN 6000TL-X')).toBe(false);
    expect(modeloCoincide('MIN 6000TL-X', 'MIN 6000TL-XH')).toBe(false);
    expect(modeloCoincide('SPH6000TL BL-US', 'SPH6000TL BL-UP')).toBe(false);
  });

  test('vacío o null → false', () => {
    expect(modeloCoincide('LR7-72HTH-615M', null)).toBe(false);
    expect(modeloCoincide(null, 'LR7-72HTH-615M')).toBe(false);
    expect(modeloCoincide(null, null)).toBe(false);
  });
});
