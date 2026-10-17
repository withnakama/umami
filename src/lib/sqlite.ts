import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export class SqliteAdapter extends PrismaBetterSqlite3 {
  async connect() {
    const adapter = await super.connect();
    // shortcut: Prisma exposes this driver handle only at runtime; recheck after adapter upgrades.
    const db = (
      adapter as unknown as {
        client: {
          function: (name: string, fn: (...args: string[]) => string | number) => void;
          pragma: (statement: string) => unknown;
          aggregate: (
            name: string,
            options: {
              start: () => Map<number, number>;
              step: (
                state: Map<number, number>,
                value: number | bigint | null,
              ) => Map<number, number>;
              result: (state: Map<number, number>) => number | null;
            },
          ) => void;
        };
      }
    ).client;

    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    const formatters = new Map<string, Intl.DateTimeFormat>();
    db.function('timezone_datetime', (value, timezone) => {
      if (!value) return '';
      let formatter = formatters.get(timezone);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        });
        formatters.set(timezone, formatter);
      }
      const parts = formatter.formatToParts(new Date(value));
      const item = (name: string) => parts.find(part => part.type === name)?.value;
      return `${item('year')}-${item('month')}-${item('day')} ${item('hour')}:${item('minute')}:${item('second')}`;
    });
    db.function('regexp', (pattern, value) => Number(new RegExp(pattern, 'i').test(value ?? '')));
    db.function('regexp_replace', (value, pattern, replacement) =>
      (value ?? '').replace(new RegExp(pattern, 'g'), replacement),
    );
    db.aggregate('mode', {
      start: () => new Map(),
      step: (state, value) => {
        if (value !== null) {
          const number = Number(value);
          state.set(number, (state.get(number) ?? 0) + 1);
        }
        return state;
      },
      result: state =>
        [...state.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null,
    });
    db.aggregate('percentile_cont', {
      start: () => ({ values: [] as number[], percentile: 0 }),
      step: (
        state: { values: number[]; percentile: number },
        value: number | bigint | null,
        percentile: number,
      ) => {
        if (value !== null) state.values.push(Number(value));
        state.percentile = percentile;
        return state;
      },
      result: (state: { values: number[]; percentile: number }) => {
        if (!state.values.length) return null;
        state.values.sort((a, b) => a - b);
        const index = (state.values.length - 1) * state.percentile;
        const lower = Math.floor(index);
        return (
          state.values[lower] +
          (state.values[Math.ceil(index)] - state.values[lower]) * (index - lower)
        );
      },
    } as any);

    return adapter;
  }
}
