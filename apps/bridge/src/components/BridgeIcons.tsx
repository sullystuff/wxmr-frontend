import type { SVGProps } from "react";

export type IconName =
  | "arrow"
  | "external"
  | "switch"
  | "shield"
  | "clock"
  | "chevron"
  | "check"
  | "wallet"
  | "copy"
  | "qr"
  | "refresh"
  | "code"
  | "close"
  | "activity"
  | "info"
  | "download";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  external: (
    <>
      <path d="M14 4h6v6m0-6L10 14" />
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
    </>
  ),
  switch: (
    <>
      <path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  wallet: (
    <>
      <path d="M20 8V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6" />
      <path d="M20 12h-5v4h5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  qr: (
    <>
      <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
      <path d="M7 7h2v2H7zm8 0h2v2h-2zM7 15h2v2H7zm6-2h3v3h-3zm4 4h1v1h-1z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6" />
    </>
  ),
  code: <path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function TokenIcon({
  token,
  className = "",
}: {
  token: "xmr" | "wxmr";
  className?: string;
}) {
  return (
    <span
      className={`token-icon token-${token} ${className}`}
      aria-hidden="true"
    >
      {token === "xmr" ? (
        <svg viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="currentColor" />
          <path
            d="M5 22h4V11l7 7 7-7v11h4M9 11v11m14-11v11"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinejoin="miter"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="15.5" stroke="currentColor" />
          <path
            d="m7 12 4 10 5-8 5 8 4-10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M10 8h12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </span>
  );
}
