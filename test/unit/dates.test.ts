import { describe, expect, it } from 'vitest';
import {
    Clock,
    getToday,
    parseDate,
    daysBetween,
    formatIsoDate,
    startOfToday,
    isDateInRange,
    parseNaturalDateRange,
} from '../../src/core/dates';

/** Fixed clock at a LOCAL wall-clock instant. */
function clockAt(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Clock {
    return () => new Date(y, mo - 1, d, h, mi, s);
}

describe('getToday (F-06: local, not UTC)', () => {
    it('returns the LOCAL calendar date late in the evening (negative-UTC-offset scenario)', () => {
        // Local 2026-01-01 23:30 — e.g. the equivalent of
        // 2026-01-01T23:30:00-08:00 for a Pacific-time user, whose UTC date
        // has already rolled over to 2026-01-02. getToday must report the
        // local date the user sees on their wall clock.
        const lateEvening = clockAt(2026, 1, 1, 23, 30);
        expect(getToday(lateEvening)).toBe('2026-01-01');
    });

    it('derives from local time even when the UTC date differs (documents the old toISOString bug)', () => {
        const d = new Date(2026, 0, 1, 23, 30);
        if (d.getTimezoneOffset() > 0) {
            // West of UTC: the UTC calendar date has already rolled over —
            // exactly the input where the old implementation was off by one.
            expect(d.toISOString().split('T')[0]).toBe('2026-01-02');
        }
        expect(getToday(() => d)).toBe('2026-01-01');
    });

    it('flips exactly at the local midnight boundary', () => {
        expect(getToday(clockAt(2026, 3, 31, 23, 59, 59))).toBe('2026-03-31');
        expect(getToday(clockAt(2026, 4, 1, 0, 0, 0))).toBe('2026-04-01');
    });

    it('agrees with startOfToday and parseDate on the same clock', () => {
        const clock = clockAt(2026, 12, 31, 23, 45);
        const today = getToday(clock);
        expect(today).toBe('2026-12-31');
        expect(formatIsoDate(startOfToday(clock))).toBe(today);
        expect(parseDate(today)!.getTime()).toBe(startOfToday(clock).getTime());
    });
});

describe('startOfToday', () => {
    it('is local midnight of the clock day', () => {
        const t = startOfToday(clockAt(2026, 7, 15, 18, 3, 22));
        expect([t.getFullYear(), t.getMonth(), t.getDate()]).toEqual([2026, 6, 15]);
        expect([t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()]).toEqual([
            0, 0, 0, 0,
        ]);
    });

    it('does not mutate the Date the clock returned', () => {
        const fixed = new Date(2026, 0, 1, 23, 30);
        startOfToday(() => fixed);
        expect(fixed.getHours()).toBe(23);
    });
});

describe('parseDate', () => {
    it('parses ISO dates as LOCAL midnight', () => {
        const d = parseDate('2026-02-28')!;
        expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
            2026, 1, 28, 0,
        ]);
    });

    it('finds the date inside surrounding text and rejects non-dates', () => {
        expect(formatIsoDate(parseDate('`✓2026-01-05`')!)).toBe('2026-01-05');
        expect(parseDate('no date here')).toBeNull();
    });
});

describe('daysBetween', () => {
    const cases: [string, string, number][] = [
        ['2026-01-01', '2026-01-01', 0],
        ['2026-01-01', '2026-01-02', 1],
        ['2026-01-02', '2026-01-01', 1], // symmetric (absolute)
        ['2026-01-01', '2026-01-31', 30],
        ['2026-02-28', '2026-03-01', 1], // 2026 is not a leap year
        ['2026-03-07', '2026-03-09', 2], // spans the US spring-forward DST weekend
        ['2026-12-31', '2027-01-01', 1],
    ];
    it.each(cases)('%s ↔ %s = %i days', (a, b, expected) => {
        expect(daysBetween(parseDate(a)!, parseDate(b)!)).toBe(expected);
    });
});

describe('isDateInRange', () => {
    const cases: [string, string, string, boolean][] = [
        ['2026-07-10', '2026-07-01', '2026-07-15', true],
        ['2026-07-01', '2026-07-01', '2026-07-15', true], // inclusive start
        ['2026-07-15', '2026-07-01', '2026-07-15', true], // inclusive end
        ['2026-06-30', '2026-07-01', '2026-07-15', false],
        ['2026-07-16', '2026-07-01', '2026-07-15', false],
    ];
    it.each(cases)('%s in [%s, %s] → %s', (d, start, end, expected) => {
        expect(isDateInRange(parseDate(d)!, start, end)).toBe(expected);
    });
});

describe('parseNaturalDateRange', () => {
    // Wednesday 2026-07-15, late evening — a fixed clock makes every
    // relative range deterministic.
    const clock = clockAt(2026, 7, 15, 23, 30);

    const cases: [string, { start: string; end: string; label: string } | null][] = [
        ['today', { start: '2026-07-15', end: '2026-07-15', label: 'today' }],
        ['Yesterday', { start: '2026-07-14', end: '2026-07-14', label: 'yesterday' }],
        ['last week', { start: '2026-07-08', end: '2026-07-15', label: 'last week' }],
        ['last month', { start: '2026-06-15', end: '2026-07-15', label: 'last month' }],
        // Wednesday → Monday of the same week.
        ['this week', { start: '2026-07-13', end: '2026-07-15', label: 'this week' }],
        ['this month', { start: '2026-07-01', end: '2026-07-15', label: 'this month' }],
        ['last 3 days', { start: '2026-07-12', end: '2026-07-15', label: 'last 3 days' }],
        ['last 2 weeks', { start: '2026-07-01', end: '2026-07-15', label: 'last 2 weeks' }],
        ['last 1 month', { start: '2026-06-15', end: '2026-07-15', label: 'last 1 month' }],
        ['2026-05-01', { start: '2026-05-01', end: '2026-05-01', label: '2026-05-01' }],
        [
            '2026-05-01 to 2026-05-31',
            { start: '2026-05-01', end: '2026-05-31', label: '2026-05-01 → 2026-05-31' },
        ],
        // Reversed bounds are normalized.
        [
            '2026-05-31 to 2026-05-01',
            { start: '2026-05-01', end: '2026-05-31', label: '2026-05-01 → 2026-05-31' },
        ],
        ['', null],
        ['   ', null],
        ['fortnight', null],
        ['last -3 days', null],
    ];

    it.each(cases)('%j', (input, expected) => {
        expect(parseNaturalDateRange(input, clock)).toEqual(expected);
    });

    it('uses the LOCAL date late in the evening ("today" straddling UTC midnight)', () => {
        const range = parseNaturalDateRange('today', clockAt(2026, 1, 1, 23, 30));
        expect(range).toEqual({ start: '2026-01-01', end: '2026-01-01', label: 'today' });
    });

    it('"this week" on a Sunday counts back to the preceding Monday (getDay() || 7)', () => {
        // 2026-07-19 is a Sunday.
        const range = parseNaturalDateRange('this week', clockAt(2026, 7, 19, 12, 0));
        expect(range).toEqual({ start: '2026-07-13', end: '2026-07-19', label: 'this week' });
    });
});
