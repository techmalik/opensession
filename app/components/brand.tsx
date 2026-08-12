// The OpenSession mark: three rounded rectangles standing in for agenda slots on a
// timeline, plus the wordmark. Flat color only, accent green and slate, no
// gradients or 3D per DESIGN.md. LogoMark is also the source for public/favicon.svg,
// so keep the two in sync if this changes.

export function LogoMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="7" height="16" rx="2" fill="#0b7b57" />
      <rect x="10.5" y="2" width="7" height="10" rx="2" fill="#0f172a" />
      <rect x="10.5" y="13.5" width="7" height="8.5" rx="2" fill="#94a3b8" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-sm font-semibold tracking-tight text-slate-900">OpenSession</span>
    </span>
  );
}

export function GithubIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 0C3.58 0 0 3.64 0 8.13c0 3.6 2.29 6.65 5.47 7.73.4.08.55-.17.55-.39
        0-.19-.01-.82-.01-1.49-2 .37-2.52-.5-2.68-.96-.09-.23-.48-.96-.82-1.15
        -.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67
        .07-.53.28-.88.51-1.08-1.78-.2-3.64-.91-3.64-4.02 0-.89.31-1.62.82-2.19
        -.08-.2-.36-1.03.08-2.15 0 0 .67-.22 2.2.84a7.4 7.4 0 0 1 4 0c1.53-1.06
        2.2-.84 2.2-.84.44 1.12.16 1.95.08 2.15.51.57.82 1.29.82 2.19 0 3.13
        -1.87 3.82-3.65 4.02.29.25.54.75.54 1.5 0 1.09-.01 1.97-.01 2.24
        0 .22.15.48.55.39A8.14 8.14 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z"
      />
    </svg>
  );
}
