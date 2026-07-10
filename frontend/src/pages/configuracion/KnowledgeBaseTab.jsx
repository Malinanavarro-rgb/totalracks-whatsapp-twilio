import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function KnowledgeBaseTab() {
  const [items, setItems] = useState(null);
  const [categoria, setCategoria] = useState('');
  const [contenido, setContenido] = useState('');
  const [error, setError] = useState(null);

  function cargar() {
    api.knowledgeBase().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function agregar(e) {
    e.preventDefault();
    if (!categoria.trim() || !contenido.trim()) return;
    try {
      await api.crearKnowledgeBase({ categoria: categoria.trim(), contenido: contenido.trim() });
      setCategoria('');
      setContenido('');
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function eliminar(id) {
    try {
      await api.eliminarKnowledgeBase(id);
      cargar();
    } catch (e2) {
      setError(e2.message);
    }
  }

  return (
    <div>
      <p className="operaciones-nota">
        Información que TARA usa para responder (servicios, precios, políticas, preguntas frecuentes).
      </p>

      <form className="config-form-inline" onSubmit={agregar}>
        <input placeholder="Categoría (ej. SERVICIOS)" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
        <textarea placeholder="Contenido" rows={2} value={contenido} onChange={(e) => setContenido(e.target.value)} />
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="login-error">{error}</p>}
      {items === null && <p className="operaciones-nota">Cargando…</p>}
      {items?.length === 0 && <p className="operaciones-nota">Sin contenido todavía.</p>}

      <ul className="config-kb-lista">
        {items?.map((item) => (
          <li key={item.id} className="config-kb-item">
            <strong>{item.categoria}</strong>
            <p>{item.contenido}</p>
            <button onClick={() => eliminar(item.id)}>Eliminar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
