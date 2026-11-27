function dayReader(zone: string): (date: Date) => string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  return (date) => {
    const parts = formatter.formatToParts(date);
    const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
}

// Find local midnight by searching for the first instant on the target calendar day.
// This also handles changes in UTC offset during a budget week.
function midnight(day: string, readDay: (date: Date) => string): Date {
  const nominal = Date.parse(`${day}T00:00:00Z`);
  let low = nominal - 36 * 60 * 60 * 1000;
  let high = nominal + 36 * 60 * 60 * 1000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (readDay(new Date(middle)) < day) low = middle;
    else high = middle;
  }
  return new Date(high);
}

export function weekWindow(now: Date, zone: string): { startsAt: string; resetsAt: string } {
  const readDay = dayReader(zone);
  const localDay = readDay(now);
  const date = new Date(`${localDay}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return {
    startsAt: midnight(start, readDay).toISOString(),
    resetsAt: midnight(date.toISOString().slice(0, 10), readDay).toISOString(),
  };
}
