export function getToday(): string {
    return new Date().toISOString().split('T')[0];
}

export function parseDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    return null;
}

export function daysBetween(d1: Date, d2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((d1.getTime() - d2.getTime()) / oneDay));
}

export function formatIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function startOfToday(): Date {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
}

export function isDateInRange(d: Date, startIso: string, endIso: string): boolean {
    const dIso = formatIsoDate(d);
    return dIso >= startIso && dIso <= endIso;
}

export function parseNaturalDateRange(input: string): { start: string; end: string; label: string } | null {
    const s = input.trim().toLowerCase();
    if (!s) { return null; }
    const today = startOfToday();
    const todayIso = formatIsoDate(today);

    if (s === 'today') {
        return { start: todayIso, end: todayIso, label: 'today' };
    }
    if (s === 'yesterday') {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        const yIso = formatIsoDate(y);
        return { start: yIso, end: yIso, label: 'yesterday' };
    }
    if (s === 'last week') {
        const start = new Date(today); start.setDate(start.getDate() - 7);
        return { start: formatIsoDate(start), end: todayIso, label: 'last week' };
    }
    if (s === 'last month') {
        const start = new Date(today); start.setDate(start.getDate() - 30);
        return { start: formatIsoDate(start), end: todayIso, label: 'last month' };
    }
    if (s === 'this week') {
        const day = today.getDay() || 7;
        const monday = new Date(today); monday.setDate(monday.getDate() - (day - 1));
        return { start: formatIsoDate(monday), end: todayIso, label: 'this week' };
    }
    if (s === 'this month') {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: formatIsoDate(first), end: todayIso, label: 'this month' };
    }

    let m = s.match(/^last\s+(\d+)\s+(day|days|week|weeks|month|months)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        let daysBack = n;
        if (unit.startsWith('week')) { daysBack = n * 7; }
        else if (unit.startsWith('month')) { daysBack = n * 30; }
        const start = new Date(today); start.setDate(start.getDate() - daysBack);
        return { start: formatIsoDate(start), end: todayIso, label: `last ${n} ${unit}` };
    }

    m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (m) { return { start: m[1], end: m[1], label: m[1] }; }

    m = s.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
    if (m) {
        const [s1, s2] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
        return { start: s1, end: s2, label: `${s1} → ${s2}` };
    }

    return null;
}
