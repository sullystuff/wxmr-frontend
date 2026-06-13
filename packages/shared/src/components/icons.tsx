export function UsdcIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#2775CA"/>
      <path d="M20.5 18.5c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.4 0-.8.6-1.3 1.8-1.3 1.1 0 1.7.4 2 1.2.1.2.2.3.4.3h1c.2 0 .4-.2.3-.4-.3-1.3-1.2-2.3-2.6-2.5v-1.5c0-.2-.2-.4-.4-.4h-.9c-.2 0-.4.2-.4.4v1.5c-1.7.2-2.8 1.4-2.8 2.8 0 2 1.2 2.7 3.7 3 1.9.3 2.3.7 2.3 1.5s-.7 1.4-1.9 1.4c-1.5 0-2-.6-2.2-1.4-.1-.2-.2-.3-.4-.3h-1c-.2 0-.4.2-.3.4.3 1.5 1.3 2.4 2.9 2.7v1.5c0 .2.2.4.4.4h.9c.2 0 .4-.2.4-.4v-1.5c1.8-.3 2.8-1.4 2.8-2.9z" fill="#fff"/>
    </svg>
  );
}

export function XmrIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#ff6600"/>
      <path d="M16 6c-5.5 0-10 4.5-10 10s4.5 10 10 10 10-4.5 10-10S21.5 6 16 6zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" fill="#fff" fillOpacity="0.3"/>
      <path d="M16 8l-5 5v6h2v-5l3 3 3-3v5h2v-6l-5-5z" fill="#fff"/>
    </svg>
  );
}
