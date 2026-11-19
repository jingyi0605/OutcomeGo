/** Goals per Bot: the floating window's yellow badge. */
export function countByBot(items: ReadonlyArray<{ botId: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.botId] = (counts[item.botId] ?? 0) + 1;
  return counts;
}

export const sameCounts = (
  left: Readonly<Record<string, number>> = {},
  right: Readonly<Record<string, number>> = {}
) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};
