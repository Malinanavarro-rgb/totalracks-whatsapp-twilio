-- TARA Matrix™ — PWA instalable con marca por empresa (Alina, 2026-10-02)
-- ─────────────────────────────────────────────────────────────────────────────
-- companies.logo_url ya existe pero casi nunca es cuadrado (logos reales son
-- rectangulares) — usarlo directo como ícono de app se ve recortado/distorsionado
-- por el sistema operativo. pwa_icon_url guarda un ÍCONO CUADRADO ya preparado
-- (512x512, logo centrado sobre fondo) para el manifest.webmanifest dinámico —
-- nullable: sin configurar, el manifest cae al genérico TARA-OS, cero regresión.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pwa_icon_url text;
