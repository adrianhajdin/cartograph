import { railCategories, railLabel, type RailKey } from "@/lib/roles";
import type { ParsedFile } from "@/lib/parser/types";

// The categories are the roles the repository's frameworks define, in the
// taxonomy's fixed order, with every one of them listed even at zero so each
// sits in the same place every time. Clicking one dims what isn't in it on the
// map rather than hiding it, so the shape of the whole repository stays on
// screen. Clicking it again, or another one, moves on.
export function CategoryRail({
  files,
  frameworks,
  active,
  onToggle,
}: {
  files: ParsedFile[];
  /** The adapter of every project in the repository. */
  frameworks: string[];
  active: string | null;
  onToggle: (category: RailKey) => void;
}) {
  const categories = railCategories(
    frameworks,
    files.map((f) => f.role),
  );
  return (
    <div className="py-2">
      <h2 className="px-3 pb-1 text-[11px] text-fg-muted">
        Categories <span className="tabular-nums">· {files.length} files</span>
      </h2>
      <ul>
        {categories.map(({ key, count }) => {
          const on = active === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={on}
                disabled={count === 0}
                onClick={() => onToggle(key)}
                className={`flex h-6 w-full items-center gap-2 px-3 text-left text-xs disabled:text-fg-muted ${
                  on ? "bg-accent/15 shadow-[inset_2px_0_0_var(--accent)]" : active ? "text-fg-muted enabled:hover:bg-raised" : "enabled:hover:bg-raised"
                }`}
              >
                <span className="flex-1 truncate">{railLabel(key)}</span>
                <span className="text-fg-muted tabular-nums">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
