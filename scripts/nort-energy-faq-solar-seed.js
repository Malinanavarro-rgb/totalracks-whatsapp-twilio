/**
 * TARA Matrix™ — Nort Energy: FAQ solar inicial (Alina, 2026-09-15)
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga en solar_faq las preguntas/dudas/objeciones reales que Alina
 * entregó completas en el chat. Usa su lenguaje y ejemplos textuales donde
 * los dio (apagones, inversor vs microinversor, nublado, 620W); para el
 * resto, respuestas de conocimiento fotovoltaico general — el nivel 4 de
 * su propia jerarquía de conocimiento (nunca specs de un modelo
 * específico, solo conceptos generales ya aceptados en la industria).
 *
 * Exclusivo de Nort Energy — company_id específico.
 * Idempotente: upsert por (company_id, question).
 *
 * Uso: node scripts/nort-energy-faq-solar-seed.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy
const SOURCE = 'Alina, 2026-09-15 — FAQ inicial (especialista en dudas y objeciones)';

const FAQ = [
  // ── AHORRO Y RECIBO CFE ──────────────────────────────────────────────────
  {
    category: 'FAQ_AHORRO',
    question: '¿Cuánto voy a ahorrar?',
    alternative_phrasings: ['voy a dejar de pagar CFE', 'mi recibo puede llegar a cero', 'cuánto puedo ahorrar realmente'],
    simple_answer: 'Depende de tu consumo actual, cuánta energía puede producir tu sistema, tu tarifa y las condiciones de tu techo — por eso no damos una cifra fija sin revisar tu recibo. Lo que sí es real: entre más cobertura de tu consumo logremos con el diseño, menor será tu recibo.',
    sales_followup: '¿Tienes a la mano una foto de tu recibo de CFE para calcularlo con datos reales?',
    requires_customer_data: true,
  },
  {
    category: 'FAQ_AHORRO',
    question: '¿CFE me paga la energía que produzco de más?',
    alternative_phrasings: ['qué pasa con la energía que no utilizo', 'qué es un medidor bidireccional', 'tengo que cambiar mi medidor', 'cómo se refleja la energía solar en mi recibo'],
    simple_answer: 'Con el esquema de generación distribuida, la energía que produces de más se resta de tu consumo a través de un medidor bidireccional — no te la pagan en efectivo, se acredita en tu recibo. Por eso el diseño ideal busca cubrir tu consumo, no producir mucho más de lo que usas.',
    requires_current_data: true,
    source: SOURCE,
  },
  {
    category: 'FAQ_AHORRO',
    question: '¿Por qué sigo pagando CFE si tengo paneles?',
    alternative_phrasings: ['por qué no dejo de pagar CFE del todo', 'qué pasa si consumo más después de instalar'],
    simple_answer: 'Porque normalmente sigues conectado a la red — CFE te sigue cobrando un cargo fijo de servicio, y cualquier consumo que tus paneles no alcancen a cubrir (de noche, por ejemplo) también se toma de la red.',
  },
  {
    category: 'FAQ_AHORRO',
    question: '¿Qué pasa si pongo menos paneles de los necesarios o más de los necesarios?',
    alternative_phrasings: ['puedo poner más paneles de los que necesito', 'por qué no se calcula únicamente por el monto del recibo'],
    simple_answer: 'Si pones menos, tu ahorro será menor al que esperabas porque no cubres todo tu consumo. Si pones de más, terminas generando energía que no vas a aprovechar completamente. Por eso dimensionamos con tu consumo real (no solo el monto del recibo, que puede variar por tarifa) — no a ojo.',
  },

  // ── CFE E INTERCONEXIÓN ──────────────────────────────────────────────────
  {
    category: 'FAQ_TRAMITES',
    question: '¿Necesito permiso de CFE? ¿Es legal instalar paneles?',
    alternative_phrasings: ['qué trámite se hace', 'cuánto tarda CFE', 'quién realiza el trámite', 'CFE me puede multar', 'qué es interconexión', 'qué es generación distribuida'],
    simple_answer: 'Sí, es legal y es un proceso normal — se llama interconexión / generación distribuida, y es un trámite que se hace ante CFE antes de poner en marcha el sistema. Nosotros nos encargamos del trámite como parte del servicio.',
    requires_current_data: true,
    source: SOURCE,
  },
  {
    category: 'FAQ_TRAMITES',
    question: '¿Qué pasa si instalo antes de hacer el trámite?',
    simple_answer: 'No es lo recomendable — el trámite de interconexión debe completarse para que el sistema opere de forma correcta y legal frente a CFE. Nosotros seguimos el orden correcto como parte del proceso.',
    requires_current_data: true,
  },
  {
    category: 'FAQ_TRAMITES',
    question: '¿Se puede instalar en una casa rentada o a nombre de otra persona?',
    alternative_phrasings: ['qué pasa si la casa está a nombre de otra persona', 'tengo que cambiar contrato'],
    simple_answer: 'Sí se puede, pero normalmente se necesita el consentimiento del dueño de la propiedad y, para el trámite ante CFE, es importante revisar a nombre de quién está el contrato de luz.',
    sales_followup: '¿La propiedad es tuya o rentada?',
  },
  {
    category: 'FAQ_TRAMITES',
    question: '¿Qué pasa si tengo 110V, 220V o trifásico?',
    alternative_phrasings: ['se puede instalar en trifásico', 'qué pasa con mi servicio actual'],
    simple_answer: 'El voltaje y el número de fases de tu instalación son justo de los datos que revisamos para elegir el equipo correcto — no es un impedimento, solo determina qué inversor usamos.',
    sales_followup: '¿Sabes si tu servicio es monofásico, bifásico o trifásico? Si no lo sabes, no hay problema, lo confirmamos en la visita.',
  },

  // ── CUANDO SE VA LA LUZ (respuesta textual de Alina) ────────────────────
  {
    category: 'FAQ_BATERIAS',
    question: '¿Con paneles ya no se me va la luz?',
    alternative_phrasings: ['funcionan cuando se va la luz', 'tengo electricidad durante un apagón', 'qué pasa si se va la luz'],
    simple_answer: 'No necesariamente. Los paneles tradicionales conectados a CFE normalmente dejan de alimentar la casa durante un apagón por seguridad. Si quieres seguir teniendo electricidad cuando falle CFE, podemos diseñarte un sistema con respaldo.',
    sales_followup: '¿Quieres mantener solo lo esencial (refrigerador, luces, internet) o también los climas?',
    source: SOURCE,
  },

  // ── BATERÍAS ─────────────────────────────────────────────────────────────
  {
    category: 'FAQ_BATERIAS',
    question: '¿Necesito baterías?',
    alternative_phrasings: ['puedo ponerlas después', 'sirven para toda la casa', 'pueden mantener los climas', 'cuántas necesito'],
    simple_answer: 'No son obligatorias — un sistema tradicional conectado a CFE no necesita baterías para generar ahorro. Se agregan cuando quieres tener energía durante un apagón. Cuánto duran y cuántas necesitas depende de qué aparatos quieras mantener funcionando y por cuánto tiempo, no solo de la capacidad de la batería.',
    sales_followup: '¿Qué te gustaría mantener funcionando durante un apagón: solo lo esencial o toda la casa incluyendo climas?',
    requires_customer_data: true,
  },
  {
    category: 'FAQ_BATERIAS',
    question: '¿Las baterías también se cargan con CFE? ¿Qué pasa si hay varios días nublados?',
    alternative_phrasings: ['funcionan de noche', 'se cargan con los paneles'],
    simple_answer: 'Sí, la mayoría de los sistemas con batería pueden cargarse tanto con tus paneles como con la red de CFE, así que varios días nublados seguidos no te dejan sin energía de respaldo.',
  },
  {
    category: 'FAQ_BATERIAS',
    question: '¿Qué mantenimiento y garantía tienen las baterías?',
    simple_answer: 'El mantenimiento es mínimo — depende del modelo y fabricante. La garantía específica te la confirmo con la ficha técnica del modelo exacto que se proponga para tu proyecto.',
  },

  // ── PANELES SOLARES ──────────────────────────────────────────────────────
  {
    category: 'FAQ_PANELES',
    question: '¿Cuál es el mejor panel? ¿Qué marca recomiendan?',
    simple_answer: 'No hay un panel que sea "el mejor" para todos los casos — depende de calidad, garantía, eficiencia, compatibilidad con el resto del sistema, disponibilidad y precio. Trabajamos con marcas reales de nuestro proveedor y te recomendamos la que mejor se ajuste a tu proyecto, no la más cara ni la más barata.',
  },
  {
    category: 'FAQ_PANELES',
    question: 'Me ofrecen paneles de 620 W, ¿son mejores?',
    alternative_phrasings: ['más watts significa que es mejor', 'diferencia entre 550w 580w 615w 620w'],
    simple_answer: 'No necesariamente. Tener más watts significa que cada panel puede entregar mayor potencia nominal, pero para saber si realmente es mejor hay que revisar tecnología, eficiencia, garantía, dimensiones y, muy importante, que sea compatible con el inversor.',
    sales_followup: 'Si me mandas la marca y modelo que te ofrecieron, te digo qué tan buena opción es.',
    source: SOURCE,
  },
  {
    category: 'FAQ_PANELES',
    question: '¿Qué es bifacial, monocristalino, N-Type o TOPCon?',
    simple_answer: 'Son distintas tecnologías de fabricación de paneles. En términos simples: monocristalino es el material más común y eficiente hoy en día; bifacial significa que el panel capta luz por ambos lados (útil si hay superficie reflejante debajo); N-Type y TOPCon son tecnologías más recientes que buscan mejor eficiencia y menor pérdida de rendimiento con el tiempo.',
  },
  {
    category: 'FAQ_PANELES',
    question: '¿Los paneles pierden eficiencia? ¿Cuántos años dura un panel? ¿Se rompen con granizo?',
    alternative_phrasings: ['aguantan lluvia', 'aguantan calor', 'se pueden mojar'],
    simple_answer: 'Sí, con los años producen un poco menos — por eso los fabricantes dan una garantía de producción (normalmente 25 años) que asegura un mínimo de rendimiento, no solo que "no se rompan". Están diseñados para resistir granizo, lluvia y condiciones normales de intemperie.',
  },
  {
    category: 'FAQ_MANTENIMIENTO',
    question: '¿Los paneles necesitan mantenimiento? ¿Cada cuánto se limpian?',
    alternative_phrasings: ['cómo sé si están funcionando correctamente'],
    simple_answer: 'El mantenimiento es mínimo — principalmente limpieza periódica para que el polvo no baje su rendimiento. No tienen partes móviles que se desgasten. El sistema de monitoreo te ayuda a confirmar que están produciendo como se espera.',
  },
  {
    category: 'FAQ_PRODUCCION',
    question: '¿Una sombra afecta todo el sistema?',
    simple_answer: 'Puede afectar, y cuánto depende del tipo de equipo — con microinversores, una sombra en un panel afecta principalmente a ese panel; con inversores string tradicionales, puede afectar a todo el grupo de paneles conectado en ese circuito. Es una de las cosas que revisamos al elegir el equipo correcto para tu techo.',
  },

  // ── INVERSOR VS MICROINVERSOR (respuestas textuales de Alina) ──────────
  {
    category: 'FAQ_INVERSORES',
    question: '¿Qué es un inversor?',
    simple_answer: 'Los paneles producen energía, pero tu casa necesita otro tipo de corriente para utilizarla. El inversor es el equipo que hace esa conversión para que puedas aprovechar la energía de tus paneles.',
    technical_answer: 'El inversor realiza la conversión de corriente continua (DC) proveniente del arreglo fotovoltaico a corriente alterna (AC), compatible con la instalación eléctrica de tu casa o negocio.',
    source: SOURCE,
  },
  {
    category: 'FAQ_MICROINVERSORES',
    question: '¿Qué es mejor, microinversor o inversor?',
    alternative_phrasings: ['cuál dura más', 'qué conviene si tengo sombras', 'qué conviene para una casa', 'qué conviene para un negocio', 'puedo monitorear cada panel'],
    simple_answer: 'Los dos pueden ser muy buenos; depende de tu instalación. Los microinversores trabajan los paneles de forma más independiente, lo que puede ser útil con sombras o ciertos diseños. Un inversor string puede ser una excelente opción cuando el arreglo tiene buenas condiciones y además puede resultar más conveniente en costo.',
    sales_followup: 'Si me dices cuántos paneles necesitas o me mandas tu recibo, puedo decirte cuál tendría más sentido para tu caso.',
    source: SOURCE,
  },
  {
    category: 'FAQ_INVERSORES',
    question: '¿Puedo ampliar mi sistema después?',
    simple_answer: 'Depende del diseño inicial — algunos sistemas se pueden ampliar más fácil que otros según el tipo de inversor y el espacio disponible.',
    sales_followup: 'Si sabes que quieres crecer a futuro, dínoslo desde el diseño para dejarlo contemplado.',
  },

  // ── CLIMA Y PRODUCCIÓN (nublado — respuesta textual de Alina) ──────────
  {
    category: 'FAQ_CLIMA',
    question: '¿Los paneles funcionan cuando está nublado?',
    alternative_phrasings: ['qué pasa cuando llueve', 'necesitan sol directo todo el día', 'producen de noche', 'qué pasa con una semana de lluvia'],
    simple_answer: 'Sí. Siguen produciendo porque aprovechan la luz solar, no el calor. Lo que cambia es que normalmente producirán menos que en un día con buena radiación. Por eso calculamos el sistema con la radiación promedio de tu zona y no suponiendo que todos los días estarán completamente soleados. De noche no producen, ya que no hay luz solar.',
    source: SOURCE,
  },
  {
    category: 'FAQ_CLIMA',
    question: '¿El calor produce más energía? ¿En invierno producen menos?',
    simple_answer: 'No — los paneles funcionan con luz, no con calor. De hecho, el calor excesivo puede reducir un poco su rendimiento. Lo que sí varía es la cantidad de luz solar disponible según la época del año y las condiciones del cielo.',
  },
  {
    category: 'FAQ_CLIMA',
    question: '¿El granizo, los huracanes o el viento pueden dañar los paneles?',
    alternative_phrasings: ['el viento puede levantarlos'],
    simple_answer: 'Los paneles y la estructura se instalan pensando en resistir condiciones normales de intemperie, incluyendo viento — la estructura se ancla firmemente al techo siguiendo las normas de instalación correspondientes.',
  },

  // ── TECHO E INSTALACIÓN ──────────────────────────────────────────────────
  {
    category: 'FAQ_INSTALACION',
    question: '¿Van a perforar mi techo? ¿Puede haber goteras?',
    alternative_phrasings: ['dañan la impermeabilización'],
    simple_answer: 'La instalación normalmente requiere algunos anclajes al techo, sellados correctamente para evitar filtraciones — es un proceso estándar en instalaciones fotovoltaicas, hecho con los materiales adecuados para tu tipo de techo.',
  },
  {
    category: 'FAQ_INSTALACION',
    question: '¿Se pueden instalar en lámina, teja o losa? ¿Mi techo lo soporta?',
    alternative_phrasings: ['techo inclinado', 'nave industrial', 'cochera', 'cuánto pesa el sistema', 'cuánto espacio necesito'],
    simple_answer: 'Sí, hay soluciones de estructura para distintos tipos de techo. Si tu techo lo soporta depende del peso del sistema y las condiciones estructurales — eso se confirma en la visita técnica, nunca se asume sin revisarlo.',
    sales_followup: '¿De qué material es tu techo — losa, lámina o teja?',
  },
  {
    category: 'FAQ_INSTALACION',
    question: '¿Cuánto tarda la instalación? ¿Tengo que estar en casa? ¿Me van a cortar la luz?',
    alternative_phrasings: ['dónde se instala el inversor', 'se ven los cables', 'cómo queda estéticamente'],
    simple_answer: 'Una instalación típica toma entre 1 y 3 días según el tamaño del sistema. Es recomendable que alguien esté disponible, y sí, puede haber una breve interrupción del servicio al momento de conectar el sistema.',
  },

  // ── COSTO Y RETORNO ──────────────────────────────────────────────────────
  {
    category: 'FAQ_PRECIO',
    question: '¿Cuánto cuesta poner paneles? ¿Por qué hay paneles más baratos en otro lado?',
    alternative_phrasings: ['por qué una empresa me cobra menos', 'cuánto cuesta cada panel'],
    simple_answer: 'El precio depende del tamaño del sistema que necesites, que a su vez depende de tu consumo. No vendemos "solo paneles" — un sistema completo incluye ingeniería, paneles, inversor, estructura, protecciones, instalación, configuración, monitoreo, garantías y trámites. Un precio más bajo en otro lado puede significar que algo de eso no está incluido.',
    sales_followup: '¿Tienes a la mano tu recibo de CFE para darte un número real, no un estimado genérico?',
  },
  {
    category: 'FAQ_RETORNO',
    question: '¿En cuánto tiempo recupero mi inversión? ¿Vale la pena?',
    alternative_phrasings: ['aumentan el valor de mi propiedad', 'qué pasa si vendo la casa'],
    simple_answer: 'Depende de tu inversión, tu ahorro mensual real y tu consumo — por eso hablamos de un "periodo simple de recuperación" calculado con tus datos, nunca un número genérico igual para todos.',
  },
  {
    category: 'FAQ_FINANCIAMIENTO',
    question: '¿Puedo financiarlo? ¿Puedo pagar con tarjeta?',
    simple_answer: 'Sí, ofrecemos planes de financiamiento a 12, 24 y 36 meses, además de pago de contado con descuento. El pago mensual generalmente se compensa con el ahorro en tu recibo de CFE.',
  },

  // ── GARANTÍAS ─────────────────────────────────────────────────────────────
  {
    category: 'FAQ_GARANTIA',
    question: '¿Qué garantía tienen los paneles y el inversor?',
    simple_answer: 'Son garantías distintas y no se deben confundir: los paneles suelen tener garantía de producto (por defectos de fabricación) y garantía de producción (rendimiento mínimo con los años, normalmente 25 años) — son cosas diferentes. El inversor tiene su propia garantía, normalmente menor a la del panel.',
    sales_followup: 'Si me dices la marca y modelo específico, te confirmo los años exactos con la ficha del proveedor.',
  },

  // ── SEGURIDAD ─────────────────────────────────────────────────────────────
  {
    category: 'FAQ_SEGURIDAD',
    question: '¿Los paneles pueden dar toques o provocar incendio? ¿Qué pasa si cae un rayo?',
    alternative_phrasings: ['son seguros para niños', 'qué protecciones lleva la instalación'],
    simple_answer: 'El sistema se instala con las protecciones eléctricas correspondientes (protecciones DC, AC, tierra física, entre otras) siguiendo las normas de seguridad — no es una instalación improvisada. Como cualquier instalación eléctrica, es importante que la haga personal calificado.',
  },

  // ── COMPARACIÓN CON COMPETENCIA ─────────────────────────────────────────
  {
    category: 'FAQ_COMPARACION',
    question: 'Me ofrecen 10 paneles en otro precio, ¿ustedes son mejores?',
    alternative_phrasings: ['me ofrecen paneles más baratos', 'comparar con otra cotización'],
    simple_answer: 'Antes de decir si somos mejores o no, vale la pena comparar a fondo: marca, modelo, watts, cantidad, kWp total, inversor o microinversor, estructura, protecciones, garantías, producción estimada, instalación, trámites, monitoreo, servicio postventa y precio final con IVA.',
    sales_followup: '¿Me compartes los detalles de esa cotización para comparar con la misma información?',
  },

  // ── CLIENTE QUE SOLO PREGUNTA PRECIO ────────────────────────────────────
  {
    category: 'FAQ_PRECIO',
    question: 'Precio de 6 paneles',
    alternative_phrasings: ['cuánto cuestan X paneles', 'dame precio de paneles'],
    simple_answer: 'Claro. El precio depende del equipo y de cuánto quieras reducir tu consumo, pero te lo puedo calcular rápido.',
    sales_followup: 'Si tienes a la mano una foto de tu recibo de CFE, mándamela y revisamos cuántos paneles realmente necesitas para no venderte de más ni de menos.',
    source: SOURCE,
  },

  // ── MITOS ─────────────────────────────────────────────────────────────────
  {
    category: 'MITO',
    question: 'Los paneles no sirven cuando está nublado',
    simple_answer: 'No es correcto — sí producen con cielo nublado, solo que un poco menos que en un día muy soleado. Calculamos el sistema con la radiación promedio de tu zona, no solo con días perfectos.',
  },
  {
    category: 'MITO',
    question: 'Necesitas baterías obligatoriamente',
    simple_answer: 'No es correcto — un sistema conectado a CFE genera ahorro sin necesidad de baterías. Las baterías se agregan solo si quieres respaldo durante apagones.',
  },
  {
    category: 'MITO',
    question: 'Si tienes paneles ya no necesitas CFE',
    simple_answer: 'No es correcto — la mayoría de los sistemas siguen conectados a la red de CFE, que complementa tu consumo cuando los paneles no producen (de noche, por ejemplo).',
  },
  {
    category: 'MITO',
    question: 'Todos los paneles son iguales',
    simple_answer: 'No es correcto — varían en tecnología, eficiencia, garantía y calidad de fabricación, por eso la marca y el modelo sí importan.',
  },
  {
    category: 'MITO',
    question: 'El panel de más watts siempre es mejor',
    simple_answer: 'No es correcto — más watts es más potencia por panel, pero "mejor" depende también de eficiencia, garantía, dimensiones y compatibilidad con el resto del sistema.',
  },
  {
    category: 'MITO',
    question: 'Entre más calor, más producen',
    simple_answer: 'No es correcto — los paneles funcionan con luz, no con calor; el calor excesivo incluso puede reducir un poco su rendimiento.',
  },
  {
    category: 'MITO',
    question: 'Con paneles nunca se va la luz',
    simple_answer: 'No es correcto — un sistema tradicional conectado a CFE deja de alimentar la casa durante un apagón por seguridad, salvo que se diseñe con respaldo/baterías.',
  },
  {
    category: 'MITO',
    question: 'Los paneles duran para siempre',
    simple_answer: 'No es correcto — tienen garantía de producción típicamente de 25 años, con una pérdida gradual de rendimiento esperada, documentada por el fabricante.',
  },
  {
    category: 'MITO',
    question: 'Solo funcionan en casas',
    simple_answer: 'No es correcto — también se instalan en negocios, industria, naves y otros inmuebles, ajustando el diseño según el consumo y las condiciones del sitio.',
  },
  {
    category: 'MITO',
    question: 'Necesitas un recibo carísimo para que convengan',
    simple_answer: 'No es correcto — el sistema se dimensiona según tu consumo real, no según un mínimo de recibo. Vale la pena revisarlo con datos reales antes de descartarlo.',
  },
];

async function upsertFaq(fila) {
  const { data: existente } = await supabase
    .from('solar_faq').select('id')
    .eq('company_id', COMPANY_ID).eq('question', fila.question)
    .maybeSingle();

  const payload = { ...fila, company_id: COMPANY_ID, source: fila.source || SOURCE };

  if (existente) {
    const { error } = await supabase.from('solar_faq').update(payload).eq('id', existente.id);
    if (error) throw new Error(`update "${fila.question}": ${error.message}`);
    return 'actualizado';
  }
  const { error } = await supabase.from('solar_faq').insert([payload]);
  if (error) throw new Error(`insert "${fila.question}": ${error.message}`);
  return 'creado';
}

(async () => {
  let creados = 0, actualizados = 0;
  for (const entrada of FAQ) {
    const r = await upsertFaq(entrada);
    r === 'creado' ? creados++ : actualizados++;
  }
  console.log(`✅ FAQ solar cargada para Nort Energy — ${creados} creadas, ${actualizados} actualizadas (total: ${FAQ.length}).`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
