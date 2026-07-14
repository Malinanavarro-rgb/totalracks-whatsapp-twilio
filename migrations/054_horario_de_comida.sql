-- TARA — Horario de comida en Agenda (Fase Premium · Salón de Belleza)
-- horarios_laborales gana dos columnas nullable: hora_inicio_descanso /
-- hora_fin_descanso. Si están vacías (caso de todas las empresas existentes
-- hasta hoy) el comportamiento no cambia — SchedulingEngine._calcularSlotsLibres
-- solo bloquea esa franja cuando ambas están presentes.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE horarios_laborales ADD COLUMN IF NOT EXISTS hora_inicio_descanso time;
ALTER TABLE horarios_laborales ADD COLUMN IF NOT EXISTS hora_fin_descanso    time;

-- Horario de comida real para Salón de Belleza (L-S, 14:00-15:00), sobre los
-- horarios generales ya sembrados en la migración 053.
UPDATE horarios_laborales
SET hora_inicio_descanso = '14:00',
    hora_fin_descanso    = '15:00'
WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
  AND asesor_id IS NULL;

-- Verificación
SELECT dia_semana, hora_inicio, hora_fin, hora_inicio_descanso, hora_fin_descanso
  FROM horarios_laborales
  WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
  ORDER BY dia_semana;
