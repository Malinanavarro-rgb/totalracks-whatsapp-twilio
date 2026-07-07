-- TARA Matrix™ — FASE 4A / Revisión de calidad pre-producción
-- Punto 1: prohibir asumir datos geográficos no provistos por el cliente
-- Punto 4: prohibir compromisos de agenda, visitas o seguimiento

UPDATE personalities
SET reglas = array_cat(
  COALESCE(reglas, ARRAY[]::text[]),
  ARRAY[
    'No menciones ciudad, estado ni dirección que el cliente no haya dicho explícitamente en este mensaje. Si el campo de ubicación está pendiente, usa solo lo que el cliente escriba literalmente en su respuesta.',
    'PROHIBIDO: No uses frases como "Verifico con el equipo", "te confirmo en la brevedad", "coordino una visita", "agendo" ni ningún compromiso de seguimiento o agenda. Si el cliente pide una visita o fecha, responde únicamente: "El equipo comercial se pondrá en contacto contigo para definir los siguientes pasos."'
  ]
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- Verificación
SELECT reglas
FROM personalities
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';
