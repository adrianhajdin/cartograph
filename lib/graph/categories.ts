// A file's kind is its extension: a fact read off the path, not a guess about
// what the file does. It's what the map's swatches colour; the rail groups by
// role instead.
const NO_EXTENSION = "(none)";

export function categoryOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? NO_EXTENSION : name.slice(dot + 1);
}

// Extensions display with their dot; "no extension" isn't one, so it gets none.
export function categoryLabel(category: string): string {
  return category === NO_EXTENSION ? category : `.${category}`;
}

export function countByCategory(paths: readonly string[]): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(categoryOf(p), (counts.get(categoryOf(p)) ?? 0) + 1);
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
