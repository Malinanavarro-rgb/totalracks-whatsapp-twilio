'use strict';

jest.mock('openai', () => ({
  toFile: jest.fn(async (buffer, filename, opts) => ({ __mockFile: true, buffer, filename, opts })),
}));

const { toFile } = require('openai');
const { transcribirAudio, describirImagen } = require('../modules/adjuntos-ia');

function crearOpenAIMock({ transcripcion = 'hola quiero información', descripcion = 'Una playera azul con logo bordado.' } = {}) {
  return {
    audio: { transcriptions: { create: jest.fn().mockResolvedValue({ text: transcripcion }) } },
    chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: descripcion } }] }) } },
  };
}

describe('adjuntos-ia', () => {
  afterEach(() => jest.clearAllMocks());

  describe('transcribirAudio()', () => {
    test('llama a Whisper con el archivo envuelto y devuelve el texto tal cual (sin envoltorio)', async () => {
      const openaiClient = crearOpenAIMock({ transcripcion: '  Hola, quiero información de precios  ' });
      const buffer = Buffer.from('audio-binario');

      const resultado = await transcribirAudio(openaiClient, buffer, 'audio/ogg; codecs=opus');

      expect(toFile).toHaveBeenCalledWith(buffer, 'audio.ogg', { type: 'audio/ogg; codecs=opus' });
      expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'whisper-1' })
      );
      expect(resultado).toBe('Hola, quiero información de precios');
    });

    test('usa el modelo indicado si se pasa explícito', async () => {
      const openaiClient = crearOpenAIMock();
      await transcribirAudio(openaiClient, Buffer.from('x'), 'audio/mpeg', 'whisper-2');
      expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'whisper-2' }));
    });

    test('sin mimeType: usa audio/ogg como fallback', async () => {
      const openaiClient = crearOpenAIMock();
      await transcribirAudio(openaiClient, Buffer.from('x'), undefined);
      expect(toFile).toHaveBeenCalledWith(expect.anything(), 'audio.ogg', { type: 'audio/ogg' });
    });

    test('respuesta sin texto: devuelve string vacío, no lanza', async () => {
      const openaiClient = crearOpenAIMock();
      openaiClient.audio.transcriptions.create.mockResolvedValue({});
      const resultado = await transcribirAudio(openaiClient, Buffer.from('x'), 'audio/ogg');
      expect(resultado).toBe('');
    });
  });

  describe('describirImagen()', () => {
    test('manda la imagen como data URI base64 y devuelve la descripción envuelta en contexto', async () => {
      const openaiClient = crearOpenAIMock({ descripcion: 'Una playera azul con logo bordado.' });
      const buffer = Buffer.from('foto-binaria');

      const resultado = await describirImagen(openaiClient, buffer, 'image/jpeg');

      const llamada = openaiClient.chat.completions.create.mock.calls[0][0];
      expect(llamada.model).toBe('gpt-4o-mini');
      const contenidoUsuario = llamada.messages[1].content;
      expect(contenidoUsuario[0].type).toBe('image_url');
      expect(contenidoUsuario[0].image_url.url).toBe(`data:image/jpeg;base64,${buffer.toString('base64')}`);
      expect(resultado).toBe('La clienta envió una imagen: Una playera azul con logo bordado.');
    });

    test('sin mimeType: usa image/jpeg como fallback', async () => {
      const openaiClient = crearOpenAIMock();
      await describirImagen(openaiClient, Buffer.from('x'), undefined);
      const llamada = openaiClient.chat.completions.create.mock.calls[0][0];
      expect(llamada.messages[1].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    test('respuesta vacía de la IA: devuelve string vacío (el caller conserva el placeholder)', async () => {
      const openaiClient = crearOpenAIMock();
      openaiClient.chat.completions.create.mockResolvedValue({ choices: [{ message: { content: '' } }] });
      const resultado = await describirImagen(openaiClient, Buffer.from('x'), 'image/png');
      expect(resultado).toBe('');
    });
  });
});
