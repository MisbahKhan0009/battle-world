/** The app mark: a lime ball and a white ring. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1A1E27" />
      <circle cx="25" cy="32" r="14" fill="#C6FF3D" />
      <circle cx="41" cy="32" r="14" fill="none" stroke="#F2F4F8" strokeWidth="5" />
    </svg>
  );
}
