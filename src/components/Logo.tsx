export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1f2937" />
      <path d="M32 34c-4-10-12-17-20-15-6 2-4 12 2 16-5 2-6 9-1 12 6 3 14-3 19-13zm0 0c4-10 12-17 20-15 6 2 4 12-2 16 5 2 6 9 1 12-6 3-14-3-19-13z" fill="#f97316" />
      <rect x="30.5" y="22" width="3" height="24" rx="1.5" fill="#fde68a" />
    </svg>
  );
}
