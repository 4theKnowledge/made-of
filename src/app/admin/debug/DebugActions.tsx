"use client";

import { useAdminToast } from "../_toast";
import { UPDATE_EVENT } from "@/components/common/VersionWatcher";

const DISMISS_PREFIX = "update-toast-dismissed:";

export function DebugActions() {
  const toast = useAdminToast();

  const fireUpdateToast = () => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(DISMISS_PREFIX)) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent(UPDATE_EVENT, {
        detail: { version: `test-${Date.now()}` },
      }),
    );
    toast.push("Update toast fired. Look bottom-right.", "info");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <button type="button" className="btn" onClick={fireUpdateToast}>
          Fire update toast
        </button>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
          Dispatches a synthetic version-drift event and clears any prior
          dismissals. Toast appears unless you&rsquo;re on <code>/combine</code>.
        </p>
      </div>
    </div>
  );
}
