export function OpenSourceLink() {
  return (
    <a
      href="https://github.com/sullystuff/wxmr-frontend"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border-hover)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--card-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)]"
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />
      </svg>
      <span className="font-semibold">Open source</span>
      <span aria-hidden="true">·</span>
      <span>View on GitHub</span>
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7M7 7h10v10" />
      </svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
