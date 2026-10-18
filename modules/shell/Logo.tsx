/** FactoryPilot mark: white F on navy with the red corner (same drawing as app/icon.svg, the favicon). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0 rounded-[4px] shadow-sm shadow-black/40">
      <rect width="100" height="100" fill="#0b1530" />
      <rect x="0" y="0" width="16" height="100" fill="#f8fafc" />
      <rect x="0" y="0" width="80" height="16" fill="#f8fafc" />
      <rect x="80" y="0" width="20" height="20" fill="#ed1c24" />
      <rect x="26" y="42" width="46" height="16" fill="#f8fafc" />
    </svg>
  );
}
