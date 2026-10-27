const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Shanghai has no daylight-saving transitions in the supported business dates. */
export function dashboardPeriod(now: Date, days: 7 | 30 | 1) {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const dateTo = shifted.toISOString().slice(0, 10);
  const todayUtc = Date.parse(`${dateTo}T00:00:00.000Z`);
  const firstDayUtc = todayUtc - (days - 1) * DAY_MS;
  return {
    startUtc: new Date(firstDayUtc - SHANGHAI_OFFSET_MS),
    endUtc: new Date(now),
    date_from: new Date(firstDayUtc).toISOString().slice(0, 10),
    date_to: dateTo,
  };
}

export function dashboardDates(dateFrom: string, days: number): string[] {
  const firstDay = Date.parse(`${dateFrom}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => new Date(firstDay + index * DAY_MS).toISOString().slice(0, 10));
}
