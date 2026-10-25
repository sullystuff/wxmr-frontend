"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ANALYTICS_OPT_OUT_KEY, ANALYTICS_PREFERENCE_EVENT } from "@/lib/analytics-policy";

function readPreference() {
  try {
    return localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === "1" ? "blocked" : "allowed";
  } catch {
    return "unavailable";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(ANALYTICS_PREFERENCE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function AnalyticsPreference() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "loading" as const);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/analytics", { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((value: { enabled?: boolean }) => setEnabled(value.enabled === true))
      .catch(() => setEnabled(false));
  }, []);

  function toggle() {
    try {
      const block = preference !== "blocked";
      if (block) localStorage.setItem(ANALYTICS_OPT_OUT_KEY, "1");
      else localStorage.removeItem(ANALYTICS_OPT_OUT_KEY);
    } catch {
      // Reading the preference will report unavailable and exclude measurement.
    }
    window.dispatchEvent(new Event(ANALYTICS_PREFERENCE_EVENT));
  }

  return (
    <div className="analytics-preference">
      <p role="status">
        {enabled === null ? "Checking traffic measurement status…" : enabled
          ? "Anonymous traffic measurement is enabled on this site."
          : "Anonymous traffic measurement is currently disabled on this site."}
        {preference === "blocked" && " You have opted out in this browser."}
        {preference === "unavailable" && " Browser storage is unavailable, so this browser is excluded from measurement."}
      </p>
      <button type="button" className="secondary-button" disabled={preference === "loading" || preference === "unavailable"} onClick={toggle}>
        {preference === "blocked" ? "Allow anonymous statistics" : "Opt out of anonymous statistics"}
      </button>
      <p>The opt-out saves only a yes/no preference in this browser. Do Not Track and Global Privacy Control also disable measurement, even if you select Allow here.</p>
    </div>
  );
}
