// Isotipo de TARA — "A" abierta y asimétrica (patas de distinto largo y
// grosor, punto de acento descentrado) con el punto turquesa de marca.
// Fuente única del trazo para que se vea igual en el sidebar, el botón de
// envío de Pregúntale a TARA, o cualquier otro lugar donde aparezca.
export default function LogoTara({ size = 40, background = '#0b0f19', foreground = '#fff', dot = '#22c7b8', rounded = true, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
      {background && <rect width="100" height="100" rx={rounded ? 24 : 0} fill={background} />}
      <path d="M44 14 L14 87" stroke={foreground} strokeWidth="16" strokeLinecap="round" fill="none" />
      <path d="M44 14 L82 66" stroke={foreground} strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="57" cy="76" r="7" fill={dot} />
    </svg>
  );
}
