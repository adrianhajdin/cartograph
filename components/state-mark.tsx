import type { Status } from "@/lib/pipeline/stages";

// State is carried by shape, not hue: green, amber and blue already mean
// direction and interaction elsewhere, so status stays greyscale. The ring
// fills as an analysis progresses; failure crosses it out; a stale run's ring
// is broken, because nothing is holding it any more.
export function StateMark({ status, stale = false }: { status: Status; stale?: boolean }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden="true">
      {status === "complete" ? (
        <circle cx="5" cy="5" r="4.5" fill="currentColor" />
      ) : (
        <circle
          cx="5"
          cy="5"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray={stale ? "2 1.6" : undefined}
        />
      )}
      {status === "running" && !stale && <path d="M5 1 A4 4 0 0 1 5 9 Z" fill="currentColor" />}
      {status === "failed" && <path d="M2.2 2.2 L7.8 7.8 M7.8 2.2 L2.2 7.8" stroke="currentColor" strokeWidth="1" />}
    </svg>
  );
}
