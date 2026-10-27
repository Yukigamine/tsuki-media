/**
 * Formats an array of numbers into contiguous ranges.
 * E.g., [1, 2, 3, 5, 6, 8] => "1-3, 5-6, 8"
 */
export function formatContiguousRanges(numbers: number[]): string {
  if (numbers.length === 0) return "";

  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === end + 1) {
      end = current;
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = current;
      end = current;
    }
  }

  return ranges.join(", ");
}
