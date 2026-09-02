export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function monthCells(month: string): CalendarCell[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must use YYYY-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month must use YYYY-MM.');
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    return {
      date: isoDate(current),
      day: current.getUTCDate(),
      inMonth: current.getUTCMonth() === monthNumber - 1,
    };
  });
}

export function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return next.toISOString().slice(0, 7);
}
