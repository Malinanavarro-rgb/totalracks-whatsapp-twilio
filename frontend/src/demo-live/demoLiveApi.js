// Demo Live View — cliente de API propio, deliberadamente aislado.
// No reusa lib/api.js (sesión de tenant) ni admin/adminApi.js (sesión de
// Panel Maestro) — esta pantalla no tiene ningún tipo de sesión, es
// pública y de solo lectura, resuelta únicamente por el token en la URL.

export async function obtenerEstadoDemo(token) {
  const respuesta = await fetch(`/api/demo-live/${token}/estado`);
  const cuerpo = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(cuerpo.error || `Error ${respuesta.status}`);
    error.status = respuesta.status;
    throw error;
  }

  return cuerpo;
}
