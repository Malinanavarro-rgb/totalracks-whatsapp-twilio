'use strict';

const { MANIFEST_BASE, generarManifestParaEmpresa } = require('../modules/pwa');

function crearMockDb(resultado) {
  return {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(resultado),
    })),
  };
}

const COMPANY_A = 'company-aaaa';

describe('generarManifestParaEmpresa()', () => {
  test('sin companyId (visitante sin sesión) → manifest genérico, sin consultar la base', async () => {
    const db = crearMockDb({ data: null, error: null });
    const manifest = await generarManifestParaEmpresa(db, undefined);
    expect(manifest).toEqual(MANIFEST_BASE);
    expect(db.from).not.toHaveBeenCalled();
  });

  test('empresa sin pwa_icon_url configurado → manifest genérico (cero regresión)', async () => {
    const db = crearMockDb({ data: { nombre: 'Total Racks', pwa_icon_url: null, color_acento: null }, error: null });
    const manifest = await generarManifestParaEmpresa(db, COMPANY_A);
    expect(manifest).toEqual(MANIFEST_BASE);
  });

  test('empresa no encontrada → manifest genérico, nunca lanza', async () => {
    const db = crearMockDb({ data: null, error: null });
    const manifest = await generarManifestParaEmpresa(db, COMPANY_A);
    expect(manifest).toEqual(MANIFEST_BASE);
  });

  test('empresa CON pwa_icon_url → name/short_name/theme_color/icons propios, el resto queda igual al genérico', async () => {
    const db = crearMockDb({
      data: { nombre: 'Nort Energy', pwa_icon_url: 'https://cdn.example.com/nort-icon-512.png', color_acento: '#1a1a2e' },
      error: null,
    });
    const manifest = await generarManifestParaEmpresa(db, COMPANY_A);

    expect(manifest.name).toBe('Nort Energy');
    expect(manifest.short_name).toBe('Nort Energy');
    expect(manifest.theme_color).toBe('#1a1a2e');
    expect(manifest.icons).toEqual([
      { src: 'https://cdn.example.com/nort-icon-512.png', sizes: '192x192', type: 'image/png' },
      { src: 'https://cdn.example.com/nort-icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'https://cdn.example.com/nort-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    // Campos no personalizados (start_url, display, background_color, description) siguen los del genérico.
    expect(manifest.start_url).toBe(MANIFEST_BASE.start_url);
    expect(manifest.display).toBe(MANIFEST_BASE.display);
    expect(manifest.background_color).toBe(MANIFEST_BASE.background_color);
  });

  test('empresa con pwa_icon_url pero sin color_acento → theme_color cae al genérico', async () => {
    const db = crearMockDb({
      data: { nombre: 'Nort Energy', pwa_icon_url: 'https://cdn.example.com/nort-icon-512.png', color_acento: null },
      error: null,
    });
    const manifest = await generarManifestParaEmpresa(db, COMPANY_A);
    expect(manifest.theme_color).toBe(MANIFEST_BASE.theme_color);
  });

  test('empresa con pwa_icon_url pero sin nombre → name/short_name caen al genérico', async () => {
    const db = crearMockDb({
      data: { nombre: null, pwa_icon_url: 'https://cdn.example.com/nort-icon-512.png', color_acento: null },
      error: null,
    });
    const manifest = await generarManifestParaEmpresa(db, COMPANY_A);
    expect(manifest.name).toBe(MANIFEST_BASE.name);
    expect(manifest.short_name).toBe(MANIFEST_BASE.short_name);
  });
});
