import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

// Creación manual de cotización (Alina, 2026-09-15 — "necesito que haya una
// opción manual"): hasta ahora la única forma de generar una cotización era
// que un cliente terminara el workflow de WhatsApp. Esta página cubre los
// primeros dos pasos (elegir/crear cliente, capturar datos técnicos y correr
// el motor) — el resto (elegir paquete, agregar líneas, validar, generar
// PDF) vive en CotizacionDetalle.jsx una vez creada, para no duplicar esa UI.

const TIPOS_ALIMENTACION = [
  { value: '', label: 'Selecciona…' },
  { value: 'monofásica', label: 'Monofásica (casa)' },
  { value: 'bifásica', label: 'Bifásica' },
  { value: 'trifásica', label: 'Trifásica' },
];

export default function NuevaCotizacion() {
  const navigate = useNavigate();

  // Paso 1 — cliente
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ telefono: '', nombre: '', empresa: '' });

  // Paso 2 — datos técnicos
  const [infoTecnica, setInfoTecnica] = useState({
    ubicacion: '', consumo_mensual_kwh: '', importe_promedio_recibo: '',
    pct_cobertura_deseado: '90', tipo_alimentacion: '', voltaje_sitio: '', area_disponible_m2: '',
  });

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function buscarClientes(texto) {
    setBusqueda(texto);
    if (!texto.trim()) { setResultados([]); return; }
    setBuscando(true);
    try {
      const data = await api.clientesCrm({ nombre: texto });
      setResultados(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBuscando(false);
    }
  }

  async function crearCliente(e) {
    e.preventDefault();
    if (!nuevoCliente.telefono.trim()) return;
    try {
      const cliente = await api.crearClienteManual(nuevoCliente);
      setClienteSeleccionado(cliente);
      setMostrarNuevoCliente(false);
      setNuevoCliente({ telefono: '', nombre: '', empresa: '' });
    } catch (e2) {
      setError(e2.message);
    }
  }

  function campoTecnico(campo, valor) {
    setInfoTecnica((prev) => ({ ...prev, [campo]: valor }));
  }

  async function crearYCalcular(e) {
    e.preventDefault();
    if (!clienteSeleccionado) { setError('Elige o crea un cliente primero.'); return; }
    setError(null);
    setEnviando(true);
    try {
      const cotizacion = await api.crearCotizacion({ clienteId: clienteSeleccionado.id });
      await api.calcularCotizacion(cotizacion.id, {
        infoTecnica: {
          ubicacion: infoTecnica.ubicacion || null,
          consumo_mensual_kwh: infoTecnica.consumo_mensual_kwh || null,
          importe_promedio_recibo: infoTecnica.importe_promedio_recibo || null,
          pct_cobertura_deseado: infoTecnica.pct_cobertura_deseado || null,
          tipo_alimentacion: infoTecnica.tipo_alimentacion || null,
          voltaje_sitio: infoTecnica.voltaje_sitio || null,
          area_disponible_m2: infoTecnica.area_disponible_m2 || null,
        },
      });
      navigate(`/cotizaciones/${cotizacion.id}`);
    } catch (e2) {
      setError(e2.message);
      setEnviando(false);
    }
  }

  return (
    <div>
      <h1>Nueva cotización</h1>

      {error && <p className="login-error">{error}</p>}

      <section className="crm-seccion">
        <h2>1. Cliente</h2>

        {clienteSeleccionado ? (
          <p>
            <strong>{clienteSeleccionado.nombre || 'Sin nombre'}</strong> — {clienteSeleccionado.telefono}
            {' · '}
            <button type="button" className="boton-enlace" onClick={() => setClienteSeleccionado(null)}>Cambiar</button>
          </p>
        ) : (
          <>
            <div className="config-form-inline">
              <input
                type="text" placeholder="Buscar cliente por nombre o teléfono…"
                value={busqueda} onChange={(e) => buscarClientes(e.target.value)}
              />
            </div>
            {buscando && <p className="operaciones-nota">Buscando…</p>}
            {resultados.length > 0 && (
              <ul className="config-kb-lista">
                {resultados.map((c) => (
                  <li key={c.id} className="config-kb-item">
                    <button type="button" className="boton-enlace" onClick={() => setClienteSeleccionado(c)}>
                      {c.nombre || 'Sin nombre'} — {c.telefono}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!mostrarNuevoCliente ? (
              <p><button type="button" className="boton-enlace" onClick={() => setMostrarNuevoCliente(true)}>+ Cliente nuevo</button></p>
            ) : (
              <form className="crm-form-edicion" onSubmit={crearCliente}>
                <label>Teléfono (obligatorio)
                  <input type="text" required value={nuevoCliente.telefono}
                    onChange={(e) => setNuevoCliente({ ...nuevoCliente, telefono: e.target.value })} />
                </label>
                <label>Nombre
                  <input type="text" value={nuevoCliente.nombre}
                    onChange={(e) => setNuevoCliente({ ...nuevoCliente, nombre: e.target.value })} />
                </label>
                <label>Empresa (opcional)
                  <input type="text" value={nuevoCliente.empresa}
                    onChange={(e) => setNuevoCliente({ ...nuevoCliente, empresa: e.target.value })} />
                </label>
                <div>
                  <button type="submit">Crear cliente</button>
                  {' '}
                  <button type="button" className="boton-enlace" onClick={() => setMostrarNuevoCliente(false)}>Cancelar</button>
                </div>
              </form>
            )}
          </>
        )}
      </section>

      {clienteSeleccionado && (
        <section className="crm-seccion">
          <h2>2. Datos técnicos</h2>
          <p className="operaciones-nota">
            Mismos datos que se capturarían por WhatsApp. La ubicación debe coincidir con una ciudad ya cargada
            (ej. "Monterrey, Nuevo León") o el sistema no podrá resolver el HSP.
          </p>
          <form className="crm-form-edicion" onSubmit={crearYCalcular}>
            <label>Ubicación
              <input type="text" placeholder="Monterrey, Nuevo León" value={infoTecnica.ubicacion}
                onChange={(e) => campoTecnico('ubicacion', e.target.value)} />
            </label>
            <label>Consumo mensual (kWh)
              <input type="number" min="0" value={infoTecnica.consumo_mensual_kwh}
                onChange={(e) => campoTecnico('consumo_mensual_kwh', e.target.value)} />
            </label>
            <label>Importe promedio del recibo CFE ($)
              <input type="number" min="0" value={infoTecnica.importe_promedio_recibo}
                onChange={(e) => campoTecnico('importe_promedio_recibo', e.target.value)} />
            </label>
            <label>% de cobertura deseado
              <input type="number" min="1" max="100" value={infoTecnica.pct_cobertura_deseado}
                onChange={(e) => campoTecnico('pct_cobertura_deseado', e.target.value)} />
            </label>
            <label>Tipo de alimentación
              <select value={infoTecnica.tipo_alimentacion} onChange={(e) => campoTecnico('tipo_alimentacion', e.target.value)}>
                {TIPOS_ALIMENTACION.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label>Voltaje del sitio (opcional — 220V se asume en monofásica)
              <input type="number" min="0" value={infoTecnica.voltaje_sitio}
                onChange={(e) => campoTecnico('voltaje_sitio', e.target.value)} />
            </label>
            <label>Área disponible (m²)
              <input type="number" min="0" value={infoTecnica.area_disponible_m2}
                onChange={(e) => campoTecnico('area_disponible_m2', e.target.value)} />
            </label>
            <div>
              <button type="submit" disabled={enviando}>{enviando ? 'Calculando…' : 'Crear y calcular sistema'}</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
