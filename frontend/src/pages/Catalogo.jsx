import ServiciosTab from './configuracion/ServiciosTab';

// Fase Demo · Tienda Soccer: "Catálogo" en el menú reutiliza tal cual el
// CRUD de Servicios ya construido en Configuración (Pivote a producto,
// Fase 1) — mismo backend, misma tabla `servicios`, solo con otra etiqueta
// y ruta propia en el menú para esta industria.
export default function Catalogo() {
  return (
    <div>
      <h1>Catálogo</h1>
      <ServiciosTab />
    </div>
  );
}
