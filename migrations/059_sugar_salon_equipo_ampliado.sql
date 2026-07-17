-- TARA — Sugar Salon: equipo ampliado (Paty Reyes, Vale Salinas)
-- Sin cambios de esquema — asesores ya existía. Se documenta aquí para
-- auditoría, igual que el resto de los cambios directos de esta sesión.
-- Ambas heredan el horario general de la empresa (asesor_id IS NULL en
-- horarios_laborales) automáticamente — no requieren fila propia.
--
-- Ejecutar en Supabase SQL Editor (idempotente — no duplica si ya existen).

INSERT INTO asesores (company_id, nombre, activo)
SELECT '5a867538-13cb-427a-8c49-d23716391f4e', v.nombre, true
FROM (VALUES ('Paty Reyes'), ('Vale Salinas')) AS v(nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM asesores
  WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND nombre = v.nombre
);

-- Verificación
SELECT id, nombre, activo FROM asesores WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' ORDER BY nombre;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DELETE FROM asesores WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND nombre IN ('Paty Reyes', 'Vale Salinas');
