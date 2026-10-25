// Shared CSS Custom Highlight registry. Several owners (each CodeView, the
// page-wide runtime highlighter) add and remove their own ranges under the
// same highlight names, without clearing each other's.
const owners = new Map(); // owner -> Map<name, Range[]>

export const supported = typeof CSS !== "undefined" && "highlights" in CSS;

export function setRanges(owner, groups) {
  if (!supported) return;
  clearRanges(owner);
  owners.set(owner, groups);
  for (const [name, ranges] of groups) {
    let highlight = CSS.highlights.get(name);
    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set(name, highlight);
    }
    for (const range of ranges) highlight.add(range);
  }
}

export function clearRanges(owner) {
  if (!supported) return;
  const groups = owners.get(owner);
  if (!groups) return;
  for (const [name, ranges] of groups) {
    const highlight = CSS.highlights.get(name);
    if (highlight) for (const range of ranges) highlight.delete(range);
  }
  owners.delete(owner);
}
