export function normalizeYears(years: number[]): number[] {
  return [...new Set(years.filter(Number.isInteger))].sort((a, b) => a - b);
}

/** 저장된 프리셋도 양 끝 사이의 실제 데이터 연도만 선택하도록 정리한다. */
export function selectAvailableYearRange(
  requested: number[],
  available: number[],
): number[] {
  const selected = normalizeYears(requested);
  const options = normalizeYears(available);
  if (!options.length) return [];
  if (!selected.length) return options;
  const start = selected[0];
  const end = selected[selected.length - 1];
  const range = options.filter((year) => year >= start && year <= end);
  return range.length ? range : options;
}
