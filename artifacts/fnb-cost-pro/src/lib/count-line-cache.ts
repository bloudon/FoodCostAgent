export function mergeUpdatedCountLineIntoCache<T extends { id: string }>(
  lines: T[] | undefined,
  updatedLine: Partial<T> & { id: string },
): T[] | undefined {
  return lines?.map((line) =>
    line.id === updatedLine.id ? { ...line, ...updatedLine } : line,
  );
}