import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Private Traffic Statistics | wXMR",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
  alternates: { canonical: null },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
