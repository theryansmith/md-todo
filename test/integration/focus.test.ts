/**
 * Characterization tests for the four focus dimensions (Phase 3d).
 *
 * These pin the EXACT current behavior of focus-user / focus-tag /
 * focus-project / focus-activity before the FocusDimension consolidation:
 * status-bar item creation (alignment, frozen priorities, click commands,
 * subscription-managed disposal), refresh text/tooltip/visibility for the
 * unset and set states, the pick-and-set QuickPick surface (entries, order,
 * placeholders, matching options, pre-guard messages, no-definitions info),
 * the set/clear side-effect contract (state write → dim repaint in visible
 * TODO editors only → own status-bar refresh), clearAllFocus, the activity
 * menu, and the activity report flow. Only the "Wiring" block below should
 * change when the generic engine lands; every pinned expectation must
 * survive untouched.
 *
 * The divergence audit these tests encode is recorded in
 * Docs/tdd/enterprise-restructure.md, Appendix B.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeDoc } from '../helpers';
import { clearParseCache } from '../../src/vscode/document-cache';
import { parseNaturalDateRange } from '../../src/core/dates';
import { ActivityFocus } from '../../src/core/model';

// ── Wiring: bind the four focus surfaces under test. ───────────────────────
// This table is written against the pre-3d per-dimension modules and will be
// swapped to FocusDimension instances when the generic engine lands; the
// pinned expectations below must not change.
import {
    setExtensionContext,
    getFocusUser,
    setFocusUserState,
    getFocusTag,
    setFocusTagState,
    getFocusProject,
    setFocusProjectState,
    getActivityFocus,
    setActivityFocusState,
} from '../../src/vscode/state';
import {
    initFocusUserStatusBar,
    refreshFocusStatusBar,
    setFocusUser,
    clearFocusUser,
} from '../../src/features/focus/focus-user';
import {
    initFocusTagStatusBar,
    refreshFocusTagStatusBar,
    setFocusTag,
    clearFocusTag,
} from '../../src/features/focus/focus-tag';
import {
    initFocusProjectStatusBar,
    refreshFocusProjectStatusBar,
    setFocusProject,
    clearFocusProject,
} from '../../src/features/focus/focus-project';
import {
    initActivityFocusStatusBar,
    refreshActivityFocusStatusBar,
    clearActivityFocus,
    activityFocusMenu,
    showRecentlyCompleted,
} from '../../src/features/focus/focus-activity';

interface FocusSurface {
    init(context: vscode.ExtensionContext): void;
    refresh(editor: vscode.TextEditor | undefined): void;
    /** The definitions QuickPick command — absent for activity. */
    pickAndSet?: () => Promise<void>;
    clear(): Promise<void>;
    read(): unknown;
    write(value: unknown): Promise<void>;
}

// Insertion order mirrors the activation registration order in extension.ts
// (user, tag, project, activity) — tests index created status-bar items by it.
const surfaces: Record<'user' | 'tag' | 'project' | 'activity', FocusSurface> = {
    user: {
        init: initFocusUserStatusBar,
        refresh: refreshFocusStatusBar,
        pickAndSet: setFocusUser,
        clear: clearFocusUser,
        read: getFocusUser,
        write: (v) => setFocusUserState(v as string | undefined),
    },
    tag: {
        init: initFocusTagStatusBar,
        refresh: refreshFocusTagStatusBar,
        pickAndSet: setFocusTag,
        clear: clearFocusTag,
        read: getFocusTag,
        write: (v) => setFocusTagState(v as string | undefined),
    },
    project: {
        init: initFocusProjectStatusBar,
        refresh: refreshFocusProjectStatusBar,
        pickAndSet: setFocusProject,
        clear: clearFocusProject,
        read: getFocusProject,
        write: (v) => setFocusProjectState(v as string | undefined),
    },
    activity: {
        init: initActivityFocusStatusBar,
        refresh: refreshActivityFocusStatusBar,
        clear: clearActivityFocus,
        read: getActivityFocus,
        write: (v) => setActivityFocusState(v as ActivityFocus | undefined),
    },
};

/** Mirrors the mdTodo.clearAllFocus handler body in extension.ts. */
async function runClearAllFocus(): Promise<void> {
    await surfaces.user.clear();
    await surfaces.tag.clear();
    await surfaces.project.clear();
    await surfaces.activity.clear();
}
// ───────────────────────────────────────────────────────────────────────────

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Fix login flow @alice #auth `[webapp]`',
    '- [x] Ship v1 `✓2026-07-03` @bob',
    '',
    '## Users',
    '',
    '**bob** (Bob Jones): backend', // file order ≠ sorted order — pins the sort
    '**alice** (Alice Smith): frontend',
    '**Carol** (Carol Chan): design', // pins the case-insensitive sort
    '',
    '## Tags',
    '',
    '**docs**: documentation',
    '**auth**: authentication work',
    '',
    '## Projects',
    '',
    '**webapp**: The web app',
    '**Tools**: Internal tooling',
].join('\n');

const NO_DEFS_FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Lone item',
].join('\n');

const NON_TODO = ['# Just notes', '', 'not a todo file'].join('\n');

// ── Host-mock plumbing ──────────────────────────────────────────────────────

interface MockStatusBarItem {
    alignment?: number;
    priority?: number;
    text: string;
    tooltip: string;
    command: string;
    visible: boolean;
    show(): void;
    hide(): void;
    dispose(): void;
}

interface QuickPickOptions {
    placeHolder?: string;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
}

const win = vscode.window as unknown as {
    createStatusBarItem(alignment?: number, priority?: number): MockStatusBarItem;
    activeTextEditor: vscode.TextEditor | undefined;
    visibleTextEditors: vscode.TextEditor[];
    showQuickPick(
        items: readonly vscode.QuickPickItem[],
        options?: QuickPickOptions
    ): Thenable<vscode.QuickPickItem | undefined>;
    showInputBox(options?: unknown): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<undefined>;
    showInformationMessage(message: string): Thenable<undefined>;
    showTextDocument(doc: unknown, options?: unknown): Thenable<unknown>;
};

const realCreateStatusBarItem = win.createStatusBarItem.bind(win);

let createdItems: MockStatusBarItem[] = [];
let warnings: string[] = [];
let infos: string[] = [];
let quickPicks: { items: vscode.QuickPickItem[]; options: QuickPickOptions | undefined }[] = [];
let quickPickResponder: (
    items: readonly vscode.QuickPickItem[]
) => vscode.QuickPickItem | undefined = () => undefined;
let executedCommands: string[] = [];

function makeContext(): {
    context: vscode.ExtensionContext;
    store: Map<string, unknown>;
    subscriptions: { dispose(): void }[];
} {
    const store = new Map<string, unknown>();
    const subscriptions: { dispose(): void }[] = [];
    const context = {
        subscriptions,
        workspaceState: {
            get: (key: string) => store.get(key),
            update: (key: string, value: unknown) => {
                if (value === undefined) {
                    store.delete(key);
                } else {
                    store.set(key, value);
                }
                return Promise.resolve();
            },
        },
    } as unknown as vscode.ExtensionContext;
    return { context, store, subscriptions };
}

/** Init all four dimensions (extension.ts order) against a fresh context. */
function setup(): { context: vscode.ExtensionContext; subscriptions: { dispose(): void }[] } {
    const { context, subscriptions } = makeContext();
    setExtensionContext(context);
    for (const surface of Object.values(surfaces)) {
        surface.init(context);
    }
    return { context, subscriptions };
}

/** The per-dimension status-bar items created by the last setup() call. */
function items(): Record<'user' | 'tag' | 'project' | 'activity', MockStatusBarItem> {
    const four = createdItems.slice(-4);
    return { user: four[0], tag: four[1], project: four[2], activity: four[3] };
}

function makeEditor(text: string, uri?: string): { editor: vscode.TextEditor; dims: unknown[] } {
    const doc = makeDoc(text, uri);
    const dims: unknown[] = [];
    const editor = {
        document: doc,
        setDecorations: (_type: unknown, options: unknown[]) => {
            dims.push(options);
        },
    } as unknown as vscode.TextEditor;
    return { editor, dims };
}

beforeEach(() => {
    clearParseCache();
    createdItems = [];
    warnings = [];
    infos = [];
    quickPicks = [];
    executedCommands = [];
    quickPickResponder = () => undefined;
    win.createStatusBarItem = (alignment?: number, priority?: number) => {
        const item = realCreateStatusBarItem(alignment, priority);
        createdItems.push(item);
        return item;
    };
    win.showWarningMessage = (message: string) => {
        warnings.push(message);
        return Promise.resolve(undefined);
    };
    win.showInformationMessage = (message: string) => {
        infos.push(message);
        return Promise.resolve(undefined);
    };
    win.showQuickPick = (itemsArg, options) => {
        quickPicks.push({ items: [...itemsArg], options });
        return Promise.resolve(quickPickResponder(itemsArg));
    };
    (
        vscode.commands as unknown as { executeCommand(id: string): Thenable<unknown> }
    ).executeCommand = (id: string) => {
        executedCommands.push(id);
        return Promise.resolve(undefined);
    };
    win.activeTextEditor = undefined;
    win.visibleTextEditors = [];
});

// ── Pinned expectations ─────────────────────────────────────────────────────

describe('status-bar item wiring (characterization)', () => {
    it('creates four right-aligned items with frozen priorities and click commands, all subscription-managed', () => {
        const { subscriptions } = setup();
        const bars = items();
        // StatusBarAlignment.Right = 2. Right-aligned items order left-to-right
        // by DESCENDING priority: user (100), tag (99), activity (98),
        // project (97) — the frozen on-screen order.
        expect(
            (['user', 'tag', 'project', 'activity'] as const).map(
                (k) => `${k} ${bars[k].alignment}:${bars[k].priority} ${bars[k].command}`
            )
        ).toEqual([
            'user 2:100 mdTodo.setFocusUser',
            'tag 2:99 mdTodo.setFocusTag',
            'project 2:97 mdTodo.setFocusProject',
            'activity 2:98 mdTodo.activityFocusMenu',
        ]);
        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            expect(subscriptions).toContain(bars[key]);
        }
    });
});

describe('status-bar refresh (characterization)', () => {
    it('hides every item when there is no active editor', () => {
        setup();
        const bars = items();
        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            bars[key].visible = true;
            surfaces[key].refresh(undefined);
            expect(bars[key].visible, key).toBe(false);
        }
    });

    it('hides every item when the active document is not a todo file', () => {
        setup();
        const bars = items();
        const { editor } = makeEditor(NON_TODO);
        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            bars[key].visible = true;
            surfaces[key].refresh(editor);
            expect(bars[key].visible, key).toBe(false);
        }
    });

    it('pins the unset text and tooltip per dimension', () => {
        setup();
        const bars = items();
        const { editor } = makeEditor(FIXTURE);
        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            surfaces[key].refresh(editor);
        }
        expect(
            (['user', 'tag', 'project', 'activity'] as const).map(
                (k) =>
                    `${bars[k].text} | ${bars[k].tooltip} | ${bars[k].visible ? 'shown' : 'hidden'}`
            )
        ).toEqual([
            '$(person) All users | No user focus — click to focus on a user | shown',
            '$(tag) All tags | No tag focus — click to focus on a tag | shown',
            '$(project) All projects | No project focus — click to focus on a project | shown',
            '$(calendar) All time | No activity focus — click to filter by date | shown',
        ]);
    });

    it('pins the set text and tooltip per dimension (user tooltip resolves the fullname from the doc)', async () => {
        setup();
        const bars = items();
        const { editor } = makeEditor(FIXTURE);
        await surfaces.user.write('alice');
        await surfaces.tag.write('auth');
        await surfaces.project.write('webapp');
        await surfaces.activity.write({
            kind: 'completed',
            startDate: '2026-07-01',
            endDate: '2026-07-07',
            label: 'last 7 days',
        } satisfies ActivityFocus);
        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            surfaces[key].refresh(editor);
        }
        expect(
            (['user', 'tag', 'project', 'activity'] as const).map(
                (k) => `${bars[k].text} | ${bars[k].tooltip}`
            )
        ).toEqual([
            '$(person) @alice | Focused on Alice Smith — click to change',
            '$(tag) #auth | Focused on #auth — click to change',
            '$(project) [webapp] | Focused on [webapp] — click to change',
            '$(calendar) Completed: last 7 days | Activity focus: Completed (last 7 days) — click to change',
        ]);
    });

    it('user tooltip falls back to the raw shortname when it has no ## Users definition', async () => {
        setup();
        const bars = items();
        const { editor } = makeEditor(FIXTURE);
        await surfaces.user.write('ghost');
        surfaces.user.refresh(editor);
        expect(bars.user.text).toBe('$(person) @ghost');
        expect(bars.user.tooltip).toBe('Focused on ghost — click to change');
    });

    it('pins the added and stale activity text variants', async () => {
        setup();
        const bars = items();
        const { editor } = makeEditor(FIXTURE);
        await surfaces.activity.write({
            kind: 'added',
            startDate: '2026-07-01',
            endDate: '2026-07-07',
            label: 'this week',
        } satisfies ActivityFocus);
        surfaces.activity.refresh(editor);
        expect(bars.activity.text).toBe('$(calendar) Added: this week');
        expect(bars.activity.tooltip).toBe('Activity focus: Added (this week) — click to change');

        await surfaces.activity.write({
            kind: 'stale',
            staleDays: 30,
            label: 'older than 30 days',
        } satisfies ActivityFocus);
        surfaces.activity.refresh(editor);
        expect(bars.activity.text).toBe('$(calendar) Stale: older than 30 days');
        expect(bars.activity.tooltip).toBe(
            'Activity focus: Stale (older than 30 days) — click to change'
        );
    });
});

const pickable = ['user', 'tag', 'project'] as const;

function pinPickItems(picked: vscode.QuickPickItem[]): string[] {
    return picked.map(
        (p) => `${p.label} | ${p.description ?? '-'} | ${(p as { detail?: string }).detail ?? '-'}`
    );
}

describe('pick-and-set (characterization)', () => {
    it("warns 'Open a todo file first' and opens no picker when there is no active editor", async () => {
        setup();
        for (const key of pickable) {
            await surfaces[key].pickAndSet!();
        }
        expect(warnings).toEqual([
            'Open a todo file first',
            'Open a todo file first',
            'Open a todo file first',
        ]);
        expect(quickPicks).toEqual([]);
    });

    it('shows the canonical guard warning on a non-todo file and opens no picker', async () => {
        setup();
        const { editor } = makeEditor(NON_TODO);
        win.activeTextEditor = editor;
        for (const key of pickable) {
            await surfaces[key].pickAndSet!();
        }
        expect(warnings).toEqual(
            Array<string>(3).fill('Not a todo file. Add "md-todo: true" to YAML frontmatter.')
        );
        expect(quickPicks).toEqual([]);
    });

    it('pins the user picker: Clear entry first, shortname-sorted entries, options', async () => {
        setup();
        const { editor } = makeEditor(FIXTURE);
        win.activeTextEditor = editor;
        await surfaces.user.pickAndSet!();
        expect(quickPicks).toHaveLength(1);
        expect(pinPickItems(quickPicks[0].items)).toEqual([
            '$(circle-slash) Clear focus | Show all users | -',
            '$(person) @alice | Alice Smith | frontend',
            '$(person) @bob | Bob Jones | backend',
            '$(person) @Carol | Carol Chan | design',
        ]);
        expect(quickPicks[0].options).toEqual({
            placeHolder: 'Select a user to focus on (or clear)',
            matchOnDescription: true,
            matchOnDetail: true,
        });
    });

    it('pins the tag picker: Clear entry first, name-sorted entries, options', async () => {
        setup();
        const { editor } = makeEditor(FIXTURE);
        win.activeTextEditor = editor;
        await surfaces.tag.pickAndSet!();
        expect(pinPickItems(quickPicks[0].items)).toEqual([
            '$(circle-slash) Clear focus | Show all tags | -',
            '$(tag) #auth | - | authentication work',
            '$(tag) #docs | - | documentation',
        ]);
        expect(quickPicks[0].options).toEqual({
            placeHolder: 'Select a tag to focus on (or clear)',
            matchOnDescription: true,
            matchOnDetail: true,
        });
    });

    it('pins the project picker: Clear entry first, case-insensitive name sort, options', async () => {
        setup();
        const { editor } = makeEditor(FIXTURE);
        win.activeTextEditor = editor;
        await surfaces.project.pickAndSet!();
        expect(pinPickItems(quickPicks[0].items)).toEqual([
            '$(circle-slash) Clear focus | Show all projects | -',
            '$(project) Tools | - | Internal tooling',
            '$(project) webapp | - | The web app',
        ]);
        expect(quickPicks[0].options).toEqual({
            placeHolder: 'Select a project to focus on (or clear)',
            matchOnDescription: true,
            matchOnDetail: true,
        });
    });

    it('uses the focused placeholder (per-dimension token format) when a focus is set', async () => {
        setup();
        const { editor } = makeEditor(FIXTURE);
        win.activeTextEditor = editor;
        await surfaces.user.write('alice');
        await surfaces.tag.write('auth');
        await surfaces.project.write('webapp');
        for (const key of pickable) {
            await surfaces[key].pickAndSet!();
        }
        expect(quickPicks.map((q) => q.options?.placeHolder)).toEqual([
            'Currently focused on @alice',
            'Currently focused on #auth',
            'Currently focused on [webapp]',
        ]);
    });

    it('shows the no-definitions message but still opens the picker with only the Clear entry', async () => {
        setup();
        const { editor } = makeEditor(NO_DEFS_FIXTURE);
        win.activeTextEditor = editor;
        for (const key of pickable) {
            await surfaces[key].pickAndSet!();
        }
        expect(infos).toEqual([
            'No users defined. Add a "## Users" section first.',
            'No tags defined. Add a "## Tags" section first.',
            'No projects defined. Add a "## Projects" section first.',
        ]);
        expect(quickPicks.map((q) => q.items.length)).toEqual([1, 1, 1]);
        expect(quickPicks.map((q) => q.items[0].label)).toEqual(
            Array<string>(3).fill('$(circle-slash) Clear focus')
        );
    });

    it('picking a definition writes state, repaints dim ONLY in visible todo editors, refreshes the bar', async () => {
        setup();
        const bars = items();
        const todo = makeEditor(FIXTURE, 'untitled:focus-pick-todo');
        const other = makeEditor(NON_TODO, 'untitled:focus-pick-other');
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor, other.editor];
        quickPickResponder = (list) => list.find((p) => p.label === '$(person) @alice');
        await surfaces.user.pickAndSet!();
        expect(surfaces.user.read()).toBe('alice');
        // Dim repainted exactly once, only in the todo editor.
        expect(todo.dims).toHaveLength(1);
        expect(other.dims).toHaveLength(0);
        // ...and the emitted set is non-empty (something got dimmed).
        expect((todo.dims[0] as unknown[]).length).toBeGreaterThan(0);
        expect(bars.user.text).toBe('$(person) @alice');
        expect(bars.user.visible).toBe(true);
    });

    it('picking the Clear focus entry clears the state', async () => {
        setup();
        const bars = items();
        const todo = makeEditor(FIXTURE);
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor];
        await surfaces.tag.write('auth');
        quickPickResponder = (list) => list[0]; // the Clear entry
        await surfaces.tag.pickAndSet!();
        expect(surfaces.tag.read()).toBeUndefined();
        expect(bars.tag.text).toBe('$(tag) All tags');
    });

    it('cancelling the picker leaves state and editors untouched', async () => {
        setup();
        const todo = makeEditor(FIXTURE);
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor];
        await surfaces.project.write('webapp');
        quickPickResponder = () => undefined; // Esc
        await surfaces.project.pickAndSet!();
        expect(surfaces.project.read()).toBe('webapp');
        expect(todo.dims).toHaveLength(0);
    });
});

describe('set → clear round trip (characterization)', () => {
    it('clear() empties state, repaints dim only in visible todo editors, and restores the unset bar', async () => {
        setup();
        const bars = items();
        const todo = makeEditor(FIXTURE, 'untitled:focus-clear-todo');
        const other = makeEditor(NON_TODO, 'untitled:focus-clear-other');
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor, other.editor];

        await surfaces.user.write('alice');
        await surfaces.tag.write('auth');
        await surfaces.project.write('webapp');
        await surfaces.activity.write({
            kind: 'stale',
            staleDays: 30,
            label: 'older than 30 days',
        } satisfies ActivityFocus);

        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            await surfaces[key].clear();
            expect(surfaces[key].read(), key).toBeUndefined();
        }
        // One dim repaint per clear, todo editor only.
        expect(todo.dims).toHaveLength(4);
        expect(other.dims).toHaveLength(0);
        // After the last clear no focus is set — the emitted dim set is empty.
        expect(todo.dims[3]).toEqual([]);
        expect(bars.user.text).toBe('$(person) All users');
        expect(bars.tag.text).toBe('$(tag) All tags');
        expect(bars.project.text).toBe('$(project) All projects');
        expect(bars.activity.text).toBe('$(calendar) All time');
    });
});

describe('clearAllFocus (characterization)', () => {
    it('clears all four dimensions and restores every bar to its unset text', async () => {
        setup();
        const bars = items();
        const todo = makeEditor(FIXTURE);
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor];

        await surfaces.user.write('bob');
        await surfaces.tag.write('docs');
        await surfaces.project.write('Tools');
        await surfaces.activity.write({
            kind: 'added',
            startDate: '2026-07-01',
            endDate: '2026-07-07',
            label: 'this week',
        } satisfies ActivityFocus);

        await runClearAllFocus();

        for (const key of ['user', 'tag', 'project', 'activity'] as const) {
            expect(surfaces[key].read(), key).toBeUndefined();
        }
        expect((['user', 'tag', 'project', 'activity'] as const).map((k) => bars[k].text)).toEqual([
            '$(person) All users',
            '$(tag) All tags',
            '$(project) All projects',
            '$(calendar) All time',
        ]);
    });
});

describe('activity menu and report flow (characterization)', () => {
    it('pins the activity menu entries and routes the pick to its command', async () => {
        setup();
        quickPickResponder = (list) =>
            list.find((p) => p.label === '$(calendar) Show Recently Completed');
        await activityFocusMenu();
        expect(quickPicks).toHaveLength(1);
        expect(
            quickPicks[0].items.map((p) => `${p.label} -> ${(p as { command?: string }).command}`)
        ).toEqual([
            '$(circle-slash) Clear Activity Focus -> mdTodo.clearActivityFocus',
            '$(calendar) Show Recently Completed -> mdTodo.showRecentlyCompleted',
            '$(calendar) Show Recently Added -> mdTodo.showRecentlyAdded',
            '$(calendar) Show Stale Items -> mdTodo.showStaleItems',
        ]);
        expect(quickPicks[0].options).toEqual({ placeHolder: 'Activity focus' });
        expect(executedCommands).toEqual(['mdTodo.showRecentlyCompleted']);
    });

    it('showRecentlyCompleted sets the activity focus and opens a beside-preview markdown report', async () => {
        setup();
        const bars = items();
        const today = parseNaturalDateRange('today')!;
        const fixture = [
            '---',
            'md-todo: true',
            '---',
            '',
            '## Completed',
            '',
            `- [x] Ship the report \`+${today.start}\` \`✓${today.start}\``,
        ].join('\n');
        const todo = makeEditor(fixture);
        win.activeTextEditor = todo.editor;
        win.visibleTextEditors = [todo.editor];
        quickPickResponder = (list) => list.find((p) => p.label === 'Today');

        let opened: { content: string; language: string } | undefined;
        (
            vscode.workspace as unknown as { openTextDocument(arg: unknown): Thenable<unknown> }
        ).openTextDocument = (arg) => {
            opened = arg as { content: string; language: string };
            return Promise.resolve({ uri: { toString: () => 'untitled:report' } });
        };
        let shownOptions: { preview: boolean; viewColumn: number } | undefined;
        win.showTextDocument = (_doc, options) => {
            shownOptions = options as { preview: boolean; viewColumn: number };
            return Promise.resolve(undefined);
        };

        await showRecentlyCompleted(todo.editor);

        expect(surfaces.activity.read()).toEqual({
            kind: 'completed',
            startDate: today.start,
            endDate: today.end,
            label: 'today',
        });
        expect(bars.activity.text).toBe('$(calendar) Completed: today');
        expect(opened?.language).toBe('markdown');
        const lines = opened!.content.split('\n');
        expect(lines[0]).toBe('# 📅 Recently Completed — today');
        expect(lines).toContain(`**Range:** ${today.start} → ${today.end}`);
        expect(lines).toContain('**Total:** 1 items completed');
        expect(lines).toContain(`## ${today.start} (1)`);
        expect(lines).toContain(`- Ship the report — added ${today.start}, completed in 0 days`);
        expect(shownOptions).toEqual({ preview: true, viewColumn: vscode.ViewColumn.Beside });
    });
});
