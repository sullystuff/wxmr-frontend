"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PUBLIC_PATHS } from "@/lib/site-metadata";
import {
  ANALYTICS_OPT_OUT_KEY, ANALYTICS_PREFERENCE_EVENT, referrerCategory,
} from "@/lib/analytics-policy";

let configuration: Promise<boolean> | undefined;

function optedOut() {
  try {
    return navigator.doNotTrack === "1" || (window as Window & { doNotTrack?: string }).doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
      navigator.webdriver || localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return true;
  }
}

function enabled() {
  configuration ??= fetch("/api/analytics", { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
    .then((response) => response.ok ? response.json() : { enabled: false })
    .then((value: { enabled?: boolean }) => value.enabled === true)
    .catch(() => false);
  return configuration;
}

export function AnonymousAnalytics() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  const entered = useRef(false);
  const [preference, setPreference] = useState(0);

  useEffect(() => {
    const onPreference = () => setPreference((value) => value + 1);
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, onPreference);
    return () => window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, onPreference);
  }, []);

  useEffect(() => {
    if (!PUBLIC_PATHS.some((path) => path === pathname) || optedOut()) return;
    let active = true;
    const track = async () => {
      if (document.visibilityState !== "visible" || optedOut() || !await enabled()) return;
      if (!active || lastPath.current === pathname || optedOut()) return;
      const entry = !entered.current;
      lastPath.current = pathname;
      entered.current = true;
      // No location.search/hash, full URL, title, screen size, wallet state,
      // persistent ID, session storage, or raw referrer enters this payload.
      void fetch("/api/analytics", {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, entry, source: entry ? referrerCategory(document.referrer) : "Internal" }),
      }).catch(() => {});
    };
    const onVisible = () => { void track(); };
    void track();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname, preference]);

  return null;
}
