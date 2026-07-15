/**
 * Characterization tests for the three activity-bar tree views (Phase 3c).
 *
 * These pin the EXACT tree output of the current Users/Tags/Projects
 * providers — root labels/descriptions/tooltips/icons/contextValues and
 * order, section bucketing and counts, todo node labels/descriptions/
 * commands, unassigned-bucket membership, synthetic undefined-project
 * roots, and current-file tracking — so the GroupingDescriptor
 * consolidation can be verified to be behavior-preserving. Only the
 * "Wiring" block below should change when the generic engine lands; every
 * pinned expectation must survive untouched.
 *
 * The divergence audit these tests encode is recorded in
 * Docs/tdd/enterprise-restructure.md, Appendix A.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeDoc } from '../helpers';
import { clearParseCache } from '../../src/vscode/document-cache';
import { GroupingTreeProvider } from '../../src/vscode/grouping-tree';
import { usersGrouping } from '../../src/features/users/tree-users';
import { tagsGrouping } from '../../src/features/tags/tree-tags';
import { projectsGrouping } from '../../src/features/projects/tree-projects';

// ── Wiring: bind the three tree surfaces under test. ───────────────────────
// This table was written against the pre-3c per-feature provider classes and
// swapped to GroupingTreeProvider + descriptors when the generic engine
// landed; the pinned expectations below are unchanged from the pre-refactor
// originals.
interface TreeSurface {
    setCurrentTodoFile(uri: vscode.Uri | undefined): void;
    getCurrentUri(): vscode.Uri | undefined;
    getChildren(element?: never): Promise<unknown[]>;
    getTreeItem(node: never): vscode.TreeItem;
}

function makeSurfaces(memento: vscode.Memento): Record<'users' | 'tags' | 'projects', TreeSurface> {
    return {
        users: new GroupingTreeProvider(usersGrouping, memento),
        tags: new GroupingTreeProvider(tagsGrouping, memento),
        projects: new GroupingTreeProvider(projectsGrouping, memento),
    };
}
// ───────────────────────────────────────────────────────────────────────────

const FIXTURE = [
    '---', // 0
    'md-todo: true', // 1
    '---', // 2
    '', // 3
    '## Active', // 4
    '', // 5
    '- [ ] Fix login flow `+2026-07-01` #auth @alice `[webapp]`', // 6
    '  - [ ] Refactor session store @bob', // 7  (inherits [webapp])
    '- [ ] Update docs `+2026-07-03` #docs', // 8
    '- [ ] Wildcard chore', // 9
    '- [x] Ship v1 `+2026-06-20` `✓2026-07-03` @alice `[webapp]`', // 10
    '', // 11
    '## Completed', // 12
    '', // 13
    '- [x] Draft rollout plan `+2026-06-28` `✓2026-07-01` @bob #auth `[tools]`', // 14
    '- [x] Mystery finish', // 15
    '', // 16
    '## Archive', // 17
    '', // 18
    '- [x] Old thing `✓2026-01-01` @alice #auth `[Ghost]`', // 19
    '', // 20
    '## Users', // 21
    '', // 22
    '**alice** (Alice Smith): frontend', // 23
    '**bob** (Aaron Bobson): backend', // 24  (fullname sorts before Alice — pins sort-by-shortname)
    '**zed** (Zed Zeta): observer', // 25  (no todos — pins the empty-root state)
    '', // 26
    '## Tags', // 27
    '', // 28
    '**auth**: authentication work', // 29
    '**docs**: documentation', // 30
    '', // 31
    '## Projects', // 32
    '', // 33
    '**webapp**: The web app', // 34
    '**tools**: Internal tooling', // 35
    '**empty-proj**: Nothing yet', // 36  (no todos — pins the empty-root state)
].join('\n');

const NON_TODO = ['# Just notes', '', '- [ ] looks like a todo #tag @user'].join('\n');

const COLLAPSE = ['None', 'Collapsed', 'Expanded'] as const;

function fmt(item: vscode.TreeItem): string {
    const icon = (item.iconPath as vscode.ThemeIcon | undefined)?.id ?? '-';
    const collapse = COLLAPSE[item.collapsibleState ?? 0];
    const label = typeof item.label === 'string' ? item.label : (item.label?.label ?? '');
    const description = typeof item.description === 'string' ? item.description : '';
    return `[${item.contextValue ?? '-'} ${icon} ${collapse}] ${label} :: ${description}`;
}

/** Depth-first dump of the whole tree as formatted lines (2-space indent per level). */
async function dumpTree(surface: TreeSurface): Promise<string[]> {
    const lines: string[] = [];
    async function walk(nodes: unknown[], depth: number): Promise<void> {
        for (const node of nodes) {
            lines.push('  '.repeat(depth) + fmt(surface.getTreeItem(node as never)));
            await walk(await surface.getChildren(node as never), depth + 1);
        }
    }
    await walk(await surface.getChildren(), 0);
    return lines;
}

function makeMemento(): { memento: vscode.Memento; store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    const memento = {
        get: (key: string) => store.get(key),
        update: (key: string, value: unknown) => {
            store.set(key, value);
            return Promise.resolve();
        },
        keys: () => [...store.keys()],
    } as unknown as vscode.Memento;
    return { memento, store };
}

// The providers load their document through vscode.workspace.openTextDocument;
// route that through a per-test URI → document map.
const openableDocs = new Map<string, vscode.TextDocument>();

function installDoc(doc: vscode.TextDocument): vscode.Uri {
    openableDocs.set(doc.uri.toString(), doc);
    return doc.uri;
}

beforeEach(() => {
    clearParseCache();
    openableDocs.clear();
    (
        vscode.workspace as unknown as {
            openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
        }
    ).openTextDocument = (uri: vscode.Uri) => {
        const doc = openableDocs.get(uri.toString());
        return doc ? Promise.resolve(doc) : Promise.reject(new Error('vscode-mock: unknown doc'));
    };
});

function surfacesOnFixture(): Record<'users' | 'tags' | 'projects', TreeSurface> {
    const surfaces = makeSurfaces(makeMemento().memento);
    const uri = installDoc(makeDoc(FIXTURE, 'untitled:grouping-fixture'));
    for (const surface of Object.values(surfaces)) {
        surface.setCurrentTodoFile(uri);
    }
    return surfaces;
}

describe('full tree shape (characterization)', () => {
    it('pins the Users tree: labels, counts, order, sections, todo rows', async () => {
        const { users } = surfacesOnFixture();
        expect(await dumpTree(users)).toMatchInlineSnapshot(`
          [
            "[user person Collapsed] Alice Smith :: @alice  (2 active)",
            "  [section list-unordered Expanded] Active (2) :: ",
            "    [todo circle-outline None] Fix login flow #auth @alice :: added 2026-07-01",
            "    [todo check None] Ship v1 @alice :: done 2026-07-03",
            "  [section archive Expanded] Archive (1) :: ",
            "    [todo check None] Old thing @alice #auth :: done 2026-01-01",
            "[user person Collapsed] Aaron Bobson :: @bob  (1 active)",
            "  [section list-unordered Expanded] Active (1) :: ",
            "    [todo circle-outline None] Refactor session store @bob :: ",
            "  [section check-all Expanded] Completed (1) :: ",
            "    [todo check None] Draft rollout plan @bob #auth :: done 2026-07-01",
            "[user person None] Zed Zeta :: @zed  (0 active)",
            "[unassigned person-add Collapsed] Unassigned :: (2 active)",
            "  [section list-unordered Expanded] Active (2) :: ",
            "    [todo circle-outline None] Update docs #docs :: added 2026-07-03",
            "    [todo circle-outline None] Wildcard chore :: ",
            "  [section check-all Expanded] Completed (1) :: ",
            "    [todo check None] Mystery finish :: done",
          ]
        `);
    });

    it('pins the Tags tree: labels, counts, order, sections, todo rows', async () => {
        const { tags } = surfacesOnFixture();
        expect(await dumpTree(tags)).toMatchInlineSnapshot(`
          [
            "[tag-root tag Collapsed] #auth :: (1 active)",
            "  [tag-section list-unordered Expanded] Active (1) :: ",
            "    [tag-todo circle-outline None] Fix login flow #auth @alice :: added 2026-07-01",
            "  [tag-section check-all Expanded] Completed (1) :: ",
            "    [tag-todo check None] Draft rollout plan @bob #auth :: done 2026-07-01",
            "  [tag-section archive Expanded] Archive (1) :: ",
            "    [tag-todo check None] Old thing @alice #auth :: done 2026-01-01",
            "[tag-root tag Collapsed] #docs :: (1 active)",
            "  [tag-section list-unordered Expanded] Active (1) :: ",
            "    [tag-todo circle-outline None] Update docs #docs :: added 2026-07-03",
            "[untagged circle-slash Collapsed] Untagged :: (3 active)",
            "  [tag-section list-unordered Expanded] Active (3) :: ",
            "    [tag-todo circle-outline None] Refactor session store @bob :: ",
            "    [tag-todo circle-outline None] Wildcard chore :: ",
            "    [tag-todo check None] Ship v1 @alice :: done 2026-07-03",
            "  [tag-section check-all Expanded] Completed (1) :: ",
            "    [tag-todo check None] Mystery finish :: done",
          ]
        `);
    });

    it('pins the Projects tree: inheritance, synthetic roots, order, sections', async () => {
        const { projects } = surfacesOnFixture();
        expect(await dumpTree(projects)).toMatchInlineSnapshot(`
          [
            "[project-root project None] empty-proj :: (0 active)",
            "[project-root project Collapsed] tools :: (0 active)",
            "  [project-section check-all Expanded] Completed (1) :: ",
            "    [project-todo check None] Draft rollout plan @bob #auth :: done 2026-07-01",
            "[project-root project Collapsed] webapp :: (3 active)",
            "  [project-section list-unordered Expanded] Active (3) :: ",
            "    [project-todo circle-outline None] Fix login flow #auth @alice :: added 2026-07-01",
            "    [project-todo circle-outline None] Refactor session store @bob :: ",
            "    [project-todo check None] Ship v1 @alice :: done 2026-07-03",
            "[project-root warning Collapsed] Ghost :: (0 active)",
            "  [project-section archive Expanded] Archive (1) :: ",
            "    [project-todo check None] Old thing @alice #auth :: done 2026-01-01",
            "[no-project circle-slash Collapsed] No Project :: (2 active)",
            "  [project-section list-unordered Expanded] Active (2) :: ",
            "    [project-todo circle-outline None] Update docs #docs :: added 2026-07-03",
            "    [project-todo circle-outline None] Wildcard chore :: ",
            "  [project-section check-all Expanded] Completed (1) :: ",
            "    [project-todo check None] Mystery finish :: done",
          ]
        `);
    });
});

describe('root and unassigned node details (characterization)', () => {
    it('pins root tooltips: per-tree header formats + shared counts suffix', async () => {
        const s = surfacesOnFixture();
        const [aliceItem] = (await s.users.getChildren()).map((n) =>
            s.users.getTreeItem(n as never)
        );
        expect(aliceItem.tooltip).toBe(
            'Alice Smith — frontend\nActive: 2  Completed: 0  Archive: 1'
        );
        const [authItem] = (await s.tags.getChildren()).map((n) => s.tags.getTreeItem(n as never));
        expect(authItem.tooltip).toBe(
            '#auth — authentication work\nActive: 1  Completed: 1  Archive: 1'
        );
        const projectItems = (await s.projects.getChildren()).map((n) =>
            s.projects.getTreeItem(n as never)
        );
        const webapp = projectItems.find((i) => i.label === 'webapp')!;
        expect(webapp.tooltip).toBe('[webapp] — The web app\nActive: 3  Completed: 0  Archive: 0');
        const ghost = projectItems.find((i) => i.label === 'Ghost')!;
        expect(ghost.tooltip).toBe(
            '[Ghost] — Not defined in ## Projects\nActive: 0  Completed: 0  Archive: 1'
        );
        expect((ghost.iconPath as vscode.ThemeIcon).id).toBe('warning');
    });

    it('pins unassigned-bucket tooltips and identity per tree', async () => {
        const s = surfacesOnFixture();
        const last = async (surface: TreeSurface) => {
            const roots = await surface.getChildren();
            return surface.getTreeItem(roots[roots.length - 1] as never);
        };
        const unassigned = await last(s.users);
        expect(fmt(unassigned)).toBe('[unassigned person-add Collapsed] Unassigned :: (2 active)');
        expect(unassigned.tooltip).toBe(
            'Todos with no @mention\nActive: 2  Completed: 1  Archive: 0'
        );
        const untagged = await last(s.tags);
        expect(fmt(untagged)).toBe('[untagged circle-slash Collapsed] Untagged :: (3 active)');
        expect(untagged.tooltip).toBe('Todos with no #tag\nActive: 3  Completed: 1  Archive: 0');
        const noProject = await last(s.projects);
        expect(fmt(noProject)).toBe('[no-project circle-slash Collapsed] No Project :: (2 active)');
        expect(noProject.tooltip).toBe(
            'Todos with no [project]\nActive: 2  Completed: 1  Archive: 0'
        );
    });
});

describe('todo node details (characterization)', () => {
    it('pins the todo click command (vscode.open, selection at the item line) and tooltip', async () => {
        const s = surfacesOnFixture();
        const uri = s.users.getCurrentUri()!;
        const roots = await s.users.getChildren();
        const sections = await s.users.getChildren(roots[0] as never); // alice
        const todos = await s.users.getChildren(sections[0] as never); // Active
        const item = s.users.getTreeItem(todos[0] as never); // Fix login flow (line 6)
        expect(item.tooltip).toBe('- [ ] Fix login flow `+2026-07-01` #auth @alice `[webapp]`');
        const command = item.command!;
        expect(command.command).toBe('vscode.open');
        expect(command.title).toBe('Open Todo');
        const [cmdUri, opts] = command.arguments as [
            vscode.Uri,
            { selection: vscode.Range; preview: boolean },
        ];
        expect(cmdUri.toString()).toBe(uri.toString());
        expect(opts.preview).toBe(false);
        expect(opts.selection.start.line).toBe(6);
        expect(opts.selection.end.line).toBe(6);
        expect(opts.selection.start.character).toBe(0);
    });
});

describe('current-file tracking (characterization)', () => {
    it('returns no roots when no todo file has ever been current', async () => {
        const surfaces = makeSurfaces(makeMemento().memento);
        for (const surface of Object.values(surfaces)) {
            expect(await surface.getChildren()).toEqual([]);
        }
    });

    it('returns no roots when the current document is not a todo file', async () => {
        const surfaces = makeSurfaces(makeMemento().memento);
        const uri = installDoc(makeDoc(NON_TODO, 'untitled:not-a-todo'));
        for (const surface of Object.values(surfaces)) {
            surface.setCurrentTodoFile(uri);
            expect(await surface.getChildren()).toEqual([]);
        }
    });

    it('persists the last todo URI per tree and restores it on construction', async () => {
        const { memento, store } = makeMemento();
        const surfaces = makeSurfaces(memento);
        const uri = installDoc(makeDoc(FIXTURE, 'untitled:persisted'));
        for (const surface of Object.values(surfaces)) {
            surface.setCurrentTodoFile(uri);
        }
        expect(store.get('mdTodo.users.lastTodoFileUri')).toBe('untitled:persisted');
        expect(store.get('mdTodo.tags.lastTodoFileUri')).toBe('untitled:persisted');
        expect(store.get('mdTodo.projects.lastTodoFileUri')).toBe('untitled:persisted');

        const rebuilt = makeSurfaces(memento);
        for (const surface of Object.values(rebuilt)) {
            expect(surface.getCurrentUri()?.toString()).toBe('untitled:persisted');
            expect((await surface.getChildren()).length).toBeGreaterThan(0);
        }
    });
});
