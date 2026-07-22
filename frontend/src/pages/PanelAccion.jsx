import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Panel de Acción Inteligente — la ventana visible del Business Memory Core
// (BMC) y del Knowledge Consolidation Engine (KCE). Toda la lógica de negocio
// ya existe y está probada en modules/business-memory-core.js y
// modules/kce.js — esta pantalla solo la muestra y deja que un gerencial
// confirme/rechace/aplique lo que ya se propuso. El KCE es estrictamente
// bajo demanda (Fase 3A): el botón "Ejecutar análisis" es la única forma de
// dispararlo, nunca corre solo.

function nivelConfianza(confianza) {
  if (confianza >= 95) return 'alta';
  if (confianza >= 80) return 'solida';
  return 'baja';
}

function BadgeConfianza({ confianza }) {
  return <span className={`inbox-badge inbox-badge--confianza-${nivelConfianza(confianza)}`}>{confianza}%</span>;
}

function CampoRazon({ etiqueta, onConfirmar, onCancelar }) {
  const [razon, setRazon] = useState('');
  return (
    <div className="pa-tarjeta-razon">
      <input
        type="text" autoFocus placeholder={etiqueta} value={razon}
        onChange={(e) => setRazon(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && razon.trim()) onConfirmar(razon.trim()); }}
      />
      <button onClick={() => razon.trim() && onConfirmar(razon.trim())} disabled={!razon.trim()}>Enviar</button>
      <button onClick={onCancelar}>Cancelar</button>
    </div>
  );
}

function TarjetaPropuesta({ aprendizaje, onConfirmar, onRechazar }) {
  const [pidiendoRazon, setPidiendoRazon] = useState(false);
  return (
    <div className="pa-tarjeta">
      <div className="inbox-badges">
        <span className="inbox-badge">{aprendizaje.categoria}</span>
        <BadgeConfianza confianza={aprendizaje.confianza} />
      </div>
      <p className="pa-tarjeta-titulo">{aprendizaje.titulo}</p>
      <p className="pa-tarjeta-detalle">{aprendizaje.detalle}</p>
      {aprendizaje.evidencia?.resumen && <p className="pa-tarjeta-evidencia">Evidencia: {aprendizaje.evidencia.resumen}</p>}
      {pidiendoRazon ? (
        <CampoRazon
          etiqueta="Razón del rechazo (obligatoria)"
          onConfirmar={(razon) => { onRechazar(aprendizaje.id, razon); setPidiendoRazon(false); }}
          onCancelar={() => setPidiendoRazon(false)}
        />
      ) : (
        <div className="pa-tarjeta-acciones">
          <button className="pa-boton-confirmar" onClick={() => onConfirmar(aprendizaje.id)}>Confirmar</button>
          <button className="pa-boton-rechazar" onClick={() => setPidiendoRazon(true)}>Rechazar</button>
        </div>
      )}
    </div>
  );
}

function TarjetaConfirmado({ aprendizaje, onMarcarObsoleto }) {
  const [pidiendoRazon, setPidiendoRazon] = useState(false);
  return (
    <div className="pa-tarjeta">
      <div className="inbox-badges">
        <span className="inbox-badge">{aprendizaje.categoria}</span>
        <BadgeConfianza confianza={aprendizaje.confianza} />
        {aprendizaje.veces_confirmado > 1 && <span className="inbox-badge">reforzado x{aprendizaje.veces_confirmado}</span>}
      </div>
      <p className="pa-tarjeta-titulo">{aprendizaje.titulo}</p>
      <p className="pa-tarjeta-detalle">{aprendizaje.detalle}</p>
      {pidiendoRazon ? (
        <CampoRazon
          etiqueta="Razón (opcional)"
          onConfirmar={(razon) => { onMarcarObsoleto(aprendizaje.id, razon); setPidiendoRazon(false); }}
          onCancelar={() => setPidiendoRazon(false)}
        />
      ) : (
        <div className="pa-tarjeta-acciones">
          <button onClick={() => setPidiendoRazon(true)}>Marcar obsoleto</button>
        </div>
      )}
    </div>
  );
}

const ETIQUETAS_ALERTA = {
  refuerzo_sugerido: 'Refuerzo sugerido',
  posible_duplicado: 'Posible duplicado',
  contradiccion: 'Contradicción',
  posible_obsoleto: 'Posible obsoleto',
};

function TarjetaAlerta({ alerta, onAplicarRefuerzo, onResolver, onFusionar }) {
  const [pidiendoRazon, setPidiendoRazon] = useState(null); // null | 'resolver' | 'fusionar-a' | 'fusionar-b'
  return (
    <div className="pa-tarjeta">
      <div className="inbox-badges">
        <span className="inbox-badge">{ETIQUETAS_ALERTA[alerta.tipo] || alerta.tipo}</span>
        <BadgeConfianza confianza={alerta.confianza_propuesta} />
      </div>
      <p className="pa-tarjeta-detalle">{alerta.justificacion}</p>
      {pidiendoRazon === 'resolver' && (
        <CampoRazon
          etiqueta="¿Qué decidiste? (ej. confirmado_obsoleto, descartada)"
          onConfirmar={(razon) => { onResolver(alerta.id, razon); setPidiendoRazon(null); }}
          onCancelar={() => setPidiendoRazon(null)}
        />
      )}
      {(pidiendoRazon === 'fusionar-a' || pidiendoRazon === 'fusionar-b') && (
        <CampoRazon
          etiqueta="Razón de la fusión (obligatoria)"
          onConfirmar={(razon) => {
            const conservar = pidiendoRazon === 'fusionar-a' ? alerta.aprendizaje_id_a : alerta.aprendizaje_id_b;
            const descartar = pidiendoRazon === 'fusionar-a' ? alerta.aprendizaje_id_b : alerta.aprendizaje_id_a;
            onFusionar(alerta.id, conservar, descartar, razon);
            setPidiendoRazon(null);
          }}
          onCancelar={() => setPidiendoRazon(null)}
        />
      )}
      {!pidiendoRazon && (
        <div className="pa-tarjeta-acciones">
          {alerta.tipo === 'refuerzo_sugerido' && (
            <button className="pa-boton-confirmar" onClick={() => onAplicarRefuerzo(alerta.id)}>Aplicar refuerzo (+{alerta.incremento_sugerido}%)</button>
          )}
          {alerta.tipo === 'posible_duplicado' && (
            <>
              <button onClick={() => setPidiendoRazon('fusionar-a')}>Fusionar (conservar el primero)</button>
              <button onClick={() => setPidiendoRazon('fusionar-b')}>Fusionar (conservar el segundo)</button>
            </>
          )}
          <button onClick={() => setPidiendoRazon('resolver')}>Marcar como revisada</button>
        </div>
      )}
    </div>
  );
}

export default function PanelAccion() {
  const [resumen, setResumen] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [confirmados, setConfirmados] = useState(null);
  const [alertas, setAlertas] = useState(null);
  const [error, setError] = useState(null);
  const [ejecutandoKce, setEjecutandoKce] = useState(false);
  const [ultimoReporte, setUltimoReporte] = useState(null);

  function cargarTodo() {
    Promise.all([api.resumenBmc(), api.aprendizajesPendientes(), api.aprendizajesConfirmados(), api.alertasKce()])
      .then(([r, p, c, a]) => { setResumen(r); setPendientes(p); setConfirmados(c); setAlertas(a); })
      .catch((e) => setError(e.status === 403 ? 'El Panel de Acción Inteligente es solo para roles gerenciales.' : e.message));
  }

  useEffect(() => { cargarTodo(); }, []);

  async function ejecutarAnalisis() {
    setEjecutandoKce(true);
    setError(null);
    try {
      const resultado = await api.ejecutarKce();
      setUltimoReporte(resultado.reporteTexto);
      cargarTodo();
    } catch (e) {
      setError(e.message);
    } finally {
      setEjecutandoKce(false);
    }
  }

  async function accion(promesa) {
    try {
      await promesa;
      cargarTodo();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !resumen) return <p className="login-error">{error}</p>;

  return (
    <div>
      <div className="pa-encabezado">
        <div>
          <h1>Panel de Acción Inteligente</h1>
          <p className="operaciones-nota">Lo que TARA ya aprendió de tu negocio — y lo que está esperando tu revisión.</p>
        </div>
        <button onClick={ejecutarAnalisis} disabled={ejecutandoKce}>
          {ejecutandoKce ? 'Analizando…' : 'Ejecutar análisis de consolidación'}
        </button>
      </div>

      {error && <p className="login-error">{error}</p>}

      {resumen?.knowledgeScore && (
        <div className="pa-score-card">
          <div className="pa-score-numero">{resumen.knowledgeScore.score}<small>/100</small></div>
          <div>
            <strong>Knowledge Maturity Score</strong>
            <p className="operaciones-nota">{resumen.resumenEjecutivo?.resumen || 'Todavía no hay suficiente conocimiento confirmado para un resumen.'}</p>
            <div className="pa-score-desglose">
              <span><strong>{resumen.knowledgeScore.desglose.cantidad}</strong>cantidad</span>
              <span><strong>{resumen.knowledgeScore.desglose.calidadEvidencia}</strong>evidencia</span>
              <span><strong>{resumen.knowledgeScore.desglose.frecuencia}</strong>frecuencia</span>
              <span><strong>{resumen.knowledgeScore.desglose.ausenciaContradicciones}</strong>sin contradicciones</span>
              <span><strong>{resumen.knowledgeScore.desglose.estabilidad}</strong>estabilidad</span>
            </div>
          </div>
        </div>
      )}

      {ultimoReporte && (
        <div className="pa-tarjeta" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
          {ultimoReporte}
        </div>
      )}

      <div className="pa-seccion">
        <h2>Propuestas pendientes ({pendientes?.length ?? '…'})</h2>
        {pendientes?.length === 0 && <p className="pa-vacio">No hay propuestas esperando revisión.</p>}
        {pendientes?.map((a) => (
          <TarjetaPropuesta
            key={a.id} aprendizaje={a}
            onConfirmar={(id) => accion(api.confirmarAprendizajeBmc(id))}
            onRechazar={(id, razon) => accion(api.rechazarAprendizajeBmc(id, razon))}
          />
        ))}
      </div>

      <div className="pa-seccion">
        <h2>Alertas de consolidación ({alertas?.length ?? '…'})</h2>
        {alertas?.length === 0 && <p className="pa-vacio">No hay alertas pendientes del motor de consolidación.</p>}
        {alertas?.map((al) => (
          <TarjetaAlerta
            key={al.id} alerta={al}
            onAplicarRefuerzo={(id) => accion(api.aplicarRefuerzoKce(id))}
            onResolver={(id, accion_tomada) => accion(api.resolverAlertaKce(id, accion_tomada))}
            onFusionar={(alertaId, id_conservar, id_descartar, razon) =>
              accion(api.fusionarAprendizajesKce(alertaId, { id_conservar, id_descartar, razon }))}
          />
        ))}
      </div>

      <div className="pa-seccion">
        <h2>Conocimiento confirmado ({confirmados?.length ?? '…'})</h2>
        {confirmados?.length === 0 && <p className="pa-vacio">Todavía no hay aprendizajes confirmados para este negocio.</p>}
        {confirmados?.map((a) => (
          <TarjetaConfirmado
            key={a.id} aprendizaje={a}
            onMarcarObsoleto={(id, razon) => accion(api.marcarObsoletoBmc(id, razon))}
          />
        ))}
      </div>
    </div>
  );
}
