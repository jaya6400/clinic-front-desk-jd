import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Slim icon rail + pale canvas, as in the supplied screens. */
export function AppShell({ children }: { children: ReactNode }) {
  const dots = [0, 1, 2, 3, 4, 5, 6];

  return (
    <div className="min-h-screen bg-canvas p-0.75 font-sans text-ink">
      <div className="flex min-h-[calc(100vh-6px)] overflow-hidden rounded-[6px] border border-line bg-canvas">
        <nav aria-label="Main" className="flex w-15 shrink-0 flex-col items-center gap-4 border-r border-line bg-card pt-4.5">
          {dots.map((dot) =>
            dot === 2 ? (
              <Link
                key={dot}
                to="/"
                aria-label="Handoff queue"
                title="Handoff queue"
                className="size-3 rounded-full border-2 border-brand bg-card ring-2 ring-brand-soft"
              />
            ) : (
              <span key={dot} aria-hidden className="size-3 rounded-full border border-subtle/50 bg-card" />
            ),
          )}
        </nav>
        <main className="min-w-0 flex-1 px-6 pb-6 pt-4">{children}</main>
      </div>
    </div>
  );
}

export function Badge({ tone, children, className = "" }: { tone: "danger" | "warn" | "brand" | "ok"; children: ReactNode; className?: string }) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    warn: "bg-warn-soft text-warn",
    brand: "bg-brand-soft text-brand",
    ok: "bg-ok-soft text-ok",
  } as const;
  return (
    <span className={`inline-block rounded-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function reasonTone(reason: string | null): "danger" | "warn" {
  return reason === "clinical_urgent" || reason === "medical_advice" ? "danger" : "warn";
}
