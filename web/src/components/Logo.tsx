// The BoxOps mark: boxes in lanes, with the today line through them.
// Same drawing as public/favicon.svg.

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#4f7cff" />
      <rect x="5" y="7" width="15" height="5" rx="1.5" fill="#fff" />
      <rect x="11" y="13.5" width="16" height="5" rx="1.5" fill="#fff" opacity=".75" />
      <rect x="7" y="20" width="12" height="5" rx="1.5" fill="#fff" opacity=".5" />
      <rect x="15.25" y="4" width="1.5" height="24" rx=".75" fill="#e5484d" />
    </svg>
  );
}
