'use strict';

const {
  BUCKET, extensionDeMime, tipoContenidoDeMime, subirAdjunto, generarUrlFirmada,
} = require('../modules/inbox-adjuntos');

function crearMockSupabaseStorage({ errorUpload = null, errorSigned = null, signedUrl = 'https://signed.example/x' } = {}) {
  const upload = jest.fn().mockResolvedValue({ error: errorUpload });
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl }, error: errorSigned });
  const from = jest.fn(() => ({ upload, createSignedUrl }));
  return { storage: { from }, _upload: upload, _createSignedUrl: createSignedUrl, _from: from };
}

describe('inbox-adjuntos', () => {
  describe('extensionDeMime()', () => {
    test('mapea tipos conocidos', () => {
      expect(extensionDeMime('image/jpeg')).toBe('jpg');
      expect(extensionDeMime('audio/ogg')).toBe('ogg');
      expect(extensionDeMime('video/mp4')).toBe('mp4');
      expect(extensionDeMime('application/pdf')).toBe('pdf');
    });

    test('fallback razonable para tipos desconocidos', () => {
      expect(extensionDeMime('application/x-raro')).toBe('x-raro');
      expect(extensionDeMime(undefined)).toBe('bin');
    });
  });

  describe('tipoContenidoDeMime()', () => {
    test('deriva la familia correcta', () => {
      expect(tipoContenidoDeMime('image/jpeg')).toBe('imagen');
      expect(tipoContenidoDeMime('audio/ogg')).toBe('audio');
      expect(tipoContenidoDeMime('video/mp4')).toBe('video');
      expect(tipoContenidoDeMime('application/pdf')).toBe('documento');
    });
  });

  describe('subirAdjunto()', () => {
    test('sube al bucket con contentType y devuelve el path (company_id/hilo_id/uuid.ext)', async () => {
      const supabase = crearMockSupabaseStorage();
      const buffer = Buffer.from('foto');

      const path = await subirAdjunto(supabase, { company_id: 'empresa-1', hilo_id: 'hilo-1', buffer, mimeType: 'image/jpeg' });

      expect(supabase._from).toHaveBeenCalledWith(BUCKET);
      expect(supabase._upload).toHaveBeenCalledWith(
        expect.stringMatching(/^empresa-1\/hilo-1\/[0-9a-f-]+\.jpg$/),
        buffer,
        { contentType: 'image/jpeg', upsert: false }
      );
      expect(path).toMatch(/^empresa-1\/hilo-1\/[0-9a-f-]+\.jpg$/);
    });

    test('lanza si el upload falla', async () => {
      const supabase = crearMockSupabaseStorage({ errorUpload: { message: 'bucket no existe' } });

      await expect(subirAdjunto(supabase, { company_id: 'e1', hilo_id: 'h1', buffer: Buffer.from('x'), mimeType: 'image/png' }))
        .rejects.toThrow('bucket no existe');
    });
  });

  describe('generarUrlFirmada()', () => {
    test('devuelve la signedUrl con el TTL por default', async () => {
      const supabase = crearMockSupabaseStorage({ signedUrl: 'https://signed.example/foto.jpg' });

      const url = await generarUrlFirmada(supabase, 'empresa-1/hilo-1/abc.jpg');

      expect(supabase._createSignedUrl).toHaveBeenCalledWith('empresa-1/hilo-1/abc.jpg', 60);
      expect(url).toBe('https://signed.example/foto.jpg');
    });

    test('acepta un TTL explícito', async () => {
      const supabase = crearMockSupabaseStorage();
      await generarUrlFirmada(supabase, 'path/x.jpg', 300);
      expect(supabase._createSignedUrl).toHaveBeenCalledWith('path/x.jpg', 300);
    });

    test('lanza si falla la firma', async () => {
      const supabase = crearMockSupabaseStorage({ errorSigned: { message: 'path no existe' } });
      await expect(generarUrlFirmada(supabase, 'path/x.jpg')).rejects.toThrow('path no existe');
    });
  });
});
