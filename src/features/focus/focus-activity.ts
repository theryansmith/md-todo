import * as vscode from 'vscode';
import { TodoItem, ActivityFocus } from '../../core/model';
import {
    isTodoFile,
    parseDocument,
    getEffectiveEditor,
    itemMatchesActivity,
} from '../../core/parser';
import { parseDate, daysBetween, startOfToday, parseNaturalDateRange } from '../../core/dates';
import { getActivityFocus, setActivityFocusState } from '../../vscode/state';
import { updateDimDecorations } from './decoration-dim';

let activityFocusStatusBarItem: vscode.StatusBarItem | undefined;

export function initActivityFocusStatusBar(context: vscode.ExtensionContext): void {
    // Activity-focus status bar (priority 98, sits to the right of tag-focus).
    activityFocusStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        98
    );
    activityFocusStatusBarItem.command = 'mdTodo.activityFocusMenu';
    context.subscriptions.push(activityFocusStatusBarItem);
}

export function refreshActivityFocusStatusBar(editor: vscode.TextEditor | undefined) {
    if (!activityFocusStatusBarItem) {
        return;
    }
    if (!editor || !isTodoFile(editor.document)) {
        activityFocusStatusBarItem.hide();
        return;
    }
    const focus = getActivityFocus();
    if (!focus) {
        activityFocusStatusBarItem.text = '$(calendar) All time';
        activityFocusStatusBarItem.tooltip = 'No activity focus — click to filter by date';
    } else {
        const prefix =
            focus.kind === 'completed' ? 'Completed' : focus.kind === 'added' ? 'Added' : 'Stale';
        activityFocusStatusBarItem.text = `$(calendar) ${prefix}: ${focus.label}`;
        activityFocusStatusBarItem.tooltip = `Activity focus: ${prefix} (${focus.label}) — click to change`;
    }
    activityFocusStatusBarItem.show();
}

export function refreshAllActivityUI() {
    for (const v of vscode.window.visibleTextEditors) {
        if (isTodoFile(v.document)) {
            updateDimDecorations(v);
        }
    }
    refreshActivityFocusStatusBar(vscode.window.activeTextEditor);
}

async function pickDateRange(
    kind: 'completed' | 'added'
): Promise<{ start: string; end: string; label: string } | undefined> {
    type RangeItem = vscode.QuickPickItem & {
        builder?: () => { start: string; end: string; label: string };
        isCustom?: boolean;
    };
    const presets: RangeItem[] = [
        { label: 'Today', builder: () => parseNaturalDateRange('today')! },
        { label: 'Yesterday', builder: () => parseNaturalDateRange('yesterday')! },
        { label: 'Last 7 days', builder: () => parseNaturalDateRange('last 7 days')! },
        { label: 'Last 30 days', builder: () => parseNaturalDateRange('last 30 days')! },
        {
            label: 'This week',
            description: 'Mon–today',
            builder: () => parseNaturalDateRange('this week')!,
        },
        {
            label: 'This month',
            description: '1st–today',
            builder: () => parseNaturalDateRange('this month')!,
        },
        {
            label: 'Last month',
            description: '~30 days',
            builder: () => parseNaturalDateRange('last month')!,
        },
        {
            label: 'Custom…',
            description:
                'last N days/weeks/months · today · yesterday · YYYY-MM-DD · YYYY-MM-DD to YYYY-MM-DD',
            isCustom: true,
        },
    ];
    const picked = await vscode.window.showQuickPick(presets, {
        placeHolder: `Pick a date range — ${kind === 'completed' ? 'Recently Completed' : 'Recently Added'}`,
        matchOnDescription: true,
    });
    if (!picked) {
        return undefined;
    }
    if (picked.isCustom) {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter date range',
            placeHolder:
                'last 7 days, last 2 weeks, today, yesterday, YYYY-MM-DD, YYYY-MM-DD to YYYY-MM-DD',
            validateInput: (v) =>
                parseNaturalDateRange(v)
                    ? null
                    : 'Could not parse. Try: last 7 days, last 2 weeks, today, YYYY-MM-DD, etc.',
        });
        if (!input) {
            return undefined;
        }
        return parseNaturalDateRange(input)!;
    }
    return picked.builder!();
}

async function pickStaleThreshold(): Promise<{ days: number; label: string } | undefined> {
    type StaleItem = vscode.QuickPickItem & { days?: number; isCustom?: boolean };
    const defaultDays =
        vscode.workspace.getConfiguration('mdTodo').get<number>('staleAfterDays') ?? 30;
    const baseDays = [7, 14, defaultDays, 60, 90];
    const seen = new Set<number>();
    const presets: StaleItem[] = [];
    for (const d of baseDays) {
        if (seen.has(d)) {
            continue;
        }
        seen.add(d);
        presets.push({
            label: `${d} days`,
            description: d === defaultDays ? '(default from settings)' : undefined,
            days: d,
        });
    }
    presets.push({ label: 'Custom…', description: 'enter a number', isCustom: true });

    const picked = await vscode.window.showQuickPick(presets, {
        placeHolder: 'Pick a staleness threshold (incomplete items older than N days)',
    });
    if (!picked) {
        return undefined;
    }
    if (picked.isCustom) {
        const input = await vscode.window.showInputBox({
            prompt: 'Stale threshold (days)',
            placeHolder: String(defaultDays),
            validateInput: (v) =>
                /^\d+$/.test(v) && parseInt(v, 10) > 0 ? null : 'Enter a positive integer',
        });
        if (!input) {
            return undefined;
        }
        const n = parseInt(input, 10);
        return { days: n, label: `older than ${n} days` };
    }
    return { days: picked.days!, label: `older than ${picked.days} days` };
}

/**
 * Renders one completed item's report line plus, when it has a parent todo,
 * a context line naming that parent and any notes attached to it — parent
 * notes are often the only place the surrounding intent got written down.
 * Pure — exported for unit tests.
 */
export function renderCompletedItemLines(item: TodoItem): string[] {
    const lines: string[] = [];
    let info = '';
    if (item.addedDate && item.completedDate) {
        const a = parseDate(item.addedDate);
        const c = parseDate(item.completedDate);
        if (a && c) {
            info = ` — added ${item.addedDate}, completed in ${daysBetween(c, a)} days`;
        }
    }
    lines.push(`- ${item.text}${info}`);
    if (item.parent) {
        lines.push(`  - _Parent: ${item.parent.text}_`);
        for (const note of item.parent.notes) {
            lines.push(`    ${note}`);
        }
    }
    return lines;
}

async function openActivityReport(document: vscode.TextDocument, activity: ActivityFocus) {
    const parsed = parseDocument(document);
    const today = startOfToday();

    const allItems: TodoItem[] = [];
    function walk(item: TodoItem) {
        allItems.push(item);
        for (const c of item.children) {
            walk(c);
        }
    }
    for (const top of parsed.items) {
        walk(top);
    }

    const matched = allItems.filter((item) => itemMatchesActivity(item, activity, today));

    const lines: string[] = [];

    if (activity.kind === 'completed') {
        lines.push(`# 📅 Recently Completed — ${activity.label}`);
        lines.push('');
        lines.push(`**Range:** ${activity.startDate} → ${activity.endDate}`);
        lines.push(`**Total:** ${matched.length} items completed`);
        lines.push('');
        const groups = new Map<string, TodoItem[]>();
        for (const item of matched) {
            const k = item.completedDate || 'unknown';
            if (!groups.has(k)) {
                groups.set(k, []);
            }
            groups.get(k)!.push(item);
        }
        const dates = [...groups.keys()].sort().reverse();
        for (const d of dates) {
            const items = groups.get(d)!;
            lines.push(`## ${d} (${items.length})`);
            for (const item of items) {
                lines.push(...renderCompletedItemLines(item));
            }
            lines.push('');
        }
    } else if (activity.kind === 'added') {
        lines.push(`# 📅 Recently Added — ${activity.label}`);
        lines.push('');
        lines.push(`**Range:** ${activity.startDate} → ${activity.endDate}`);
        lines.push(`**Total:** ${matched.length} items added`);
        lines.push('');
        const groups = new Map<string, TodoItem[]>();
        for (const item of matched) {
            const k = item.addedDate || 'unknown';
            if (!groups.has(k)) {
                groups.set(k, []);
            }
            groups.get(k)!.push(item);
        }
        const dates = [...groups.keys()].sort().reverse();
        for (const d of dates) {
            const items = groups.get(d)!;
            lines.push(`## ${d} (${items.length})`);
            for (const item of items) {
                const status = item.isComplete
                    ? ` — ✓ completed${item.completedDate ? ' ' + item.completedDate : ''}`
                    : '';
                lines.push(`- ${item.text}${status}`);
            }
            lines.push('');
        }
    } else {
        lines.push(`# 📅 Stale Items — ${activity.label}`);
        lines.push('');
        lines.push(
            `**Total:** ${matched.length} incomplete items older than ${activity.staleDays} days`
        );
        lines.push('');
        const withAge = matched.map((item) => ({
            item,
            age:
                item.addedDate && parseDate(item.addedDate)
                    ? daysBetween(today, parseDate(item.addedDate)!)
                    : Infinity,
        }));
        withAge.sort((a, b) => b.age - a.age);
        for (const { item, age } of withAge) {
            const ageStr = age === Infinity ? 'unknown age' : `${age} days old`;
            lines.push(`- (${ageStr}) ${item.text}`);
        }
    }

    if (matched.length === 0) {
        lines.push('_(no matching items)_');
    }

    const doc = await vscode.workspace.openTextDocument({
        content: lines.join('\n'),
        language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });
}

export async function showRecentlyCompleted(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }
    const range = await pickDateRange('completed');
    if (!range) {
        return;
    }
    const focus: ActivityFocus = {
        kind: 'completed',
        startDate: range.start,
        endDate: range.end,
        label: range.label,
    };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

export async function showRecentlyAdded(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }
    const range = await pickDateRange('added');
    if (!range) {
        return;
    }
    const focus: ActivityFocus = {
        kind: 'added',
        startDate: range.start,
        endDate: range.end,
        label: range.label,
    };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

export async function showStaleItems(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }
    const threshold = await pickStaleThreshold();
    if (!threshold) {
        return;
    }
    const focus: ActivityFocus = {
        kind: 'stale',
        staleDays: threshold.days,
        label: threshold.label,
    };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

export async function clearActivityFocus(): Promise<void> {
    await setActivityFocusState(undefined);
    refreshAllActivityUI();
}

export async function activityFocusMenu(): Promise<void> {
    type Cmd = vscode.QuickPickItem & { command: string };
    const items: Cmd[] = [
        { label: '$(circle-slash) Clear Activity Focus', command: 'mdTodo.clearActivityFocus' },
        { label: '$(calendar) Show Recently Completed', command: 'mdTodo.showRecentlyCompleted' },
        { label: '$(calendar) Show Recently Added', command: 'mdTodo.showRecentlyAdded' },
        { label: '$(calendar) Show Stale Items', command: 'mdTodo.showStaleItems' },
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Activity focus' });
    if (!picked) {
        return;
    }
    await vscode.commands.executeCommand(picked.command);
}
