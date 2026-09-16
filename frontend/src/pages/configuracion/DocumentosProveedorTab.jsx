import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const TIPOS_DOCUMENTO = ['ficha_tecnica', 'lista_precios', 'catalogo', 'garantia'];

// Especialista Solar, Fase 6 — ingesta de documentos de proveedor. El
// borrador que propone la IA (datos_extraidos) NUNCA se aplica solo: un
// humano debe revisarlo y confirmarlo (opcionalmente enlazándolo a un
// producto real) antes de que se use con un cliente.
export default function DocumentosProveedorTab() {
  const [documentos, setDocumentos] = useState(null);
  const [error, setError] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [form, setForm] = useState({ proveedor: '', tipo_documento: 'ficha_tecnica', archivo: null });
  const [procesando, setProcesando] = useState({}); // { [id]: true }
  const [confirmando, setConfirmando] = useState({}); // { [id]: { producto_id, esFichaCompleta } }

  function cargar() {
    api.documentosProveedor().then(setDocumentos).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function subir(e) {
    e.preventDefault();
    if (!form.archivo) return;
    setSubiendo(true);
    setError(null);
    try {
      await api.subirDocumentoProveedor(form.archivo, { proveedor: form.proveedor, tipo_documento: form.tipo_documento });
      setForm({ proveedor: '', tipo_documento: 'ficha_tecnica', archivo: null });
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function procesar(id) {
    setProcesando((prev) => ({ ...prev, [id]: true }));
    try {
      await api.procesarDocumentoProveedor(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setProcesando((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function confirmar(id) {
    const datos = confirmando[id] || {};
    try {
      await api.confirmarDocumentoProveedor(id, {
        producto_id: datos.producto_id ? Number(datos.producto_id) : undefined,
        esFichaCompleta: !!datos.esFichaCompleta,
      });
      setConfirmando((prev) => ({ ...prev, [id]: undefined }));
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <p className="operaciones-nota">
        Sube una ficha técnica real (PDF o foto) — TARA propone un borrador de especificaciones,
        pero nunca lo usa con un cliente hasta que lo confirmes aquí.
      </p>

      <form className="config-form-inline" onSubmit={subir}>
        <input
          type="file" accept="application/pdf,image/*"
          onChange={(e) => setForm({ ...form, archivo: e.target.files?.[0] || null })}
        />
        <input
          placeholder="Proveedor (opcional)" value={form.proveedor}
          onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
        />
        <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}>
          {TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" disabled={subiendo || !form.archivo}>{subiendo ? 'Subiendo…' : 'Subir'}</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {documentos === null && <p className="operaciones-nota">Cargando…</p>}
      {documentos?.length === 0 && <p className="operaciones-nota">Sin documentos todavía.</p>}

      <ul className="config-kb-lista">
        {documentos?.map((d) => (
          <li key={d.id} className="config-kb-item">
            <strong>{d.nombre_archivo || `Documento #${d.id}`}</strong>
            {d.proveedor ? ` — ${d.proveedor}` : ''} — {d.tipo_documento}
            {' '}
            <a href={api.urlArchivoDocumentoProveedor(d.id)} target="_blank" rel="noreferrer">Ver archivo</a>

            {d.confirmado_en ? (
              <p className="operaciones-nota">Confirmado ✓{d.producto_id ? ` — enlazado a producto #${d.producto_id}` : ''}</p>
            ) : d.datos_extraidos ? (
              <div className="pregunta-tara-respuesta">
                <p><strong>Borrador (sin confirmar todavía):</strong></p>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{JSON.stringify(d.datos_extraidos, null, 2)}</pre>
                {d.datos_extraidos.es_ficha_tecnica ? (
                  <div className="config-form-inline">
                    <input
                      type="number" placeholder="ID de producto a enlazar (opcional)"
                      value={confirmando[d.id]?.producto_id || ''}
                      onChange={(e) => setConfirmando((prev) => ({ ...prev, [d.id]: { ...prev[d.id], producto_id: e.target.value } }))}
                    />
                    <label>
                      <input
                        type="checkbox" checked={!!confirmando[d.id]?.esFichaCompleta}
                        onChange={(e) => setConfirmando((prev) => ({ ...prev, [d.id]: { ...prev[d.id], esFichaCompleta: e.target.checked } }))}
                      />
                      {' '}Ficha completa
                    </label>
                    <button type="button" onClick={() => confirmar(d.id)}>Confirmar</button>
                  </div>
                ) : (
                  <p className="operaciones-nota">TARA no reconoció esto como una ficha técnica legible — no hay nada que confirmar.</p>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => procesar(d.id)} disabled={procesando[d.id]}>
                {procesando[d.id] ? 'Procesando…' : 'Procesar con TARA'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
