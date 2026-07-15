/**
 * Characterization tests for the five editor decorations (Phase 3b).
 *
 * These pin the EXACT DecorationOptions/Range output of the current
 * implementation — full scan, incremental edit path, non-todo clearing, and
 * dim's focus semantics — so the DecorationController consolidation can be
 * verified to be behavior-preserving. Only the "Wiring" block below should
 * change when the controller lands; every pinned expectation must survive
 * untouched.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeDoc } from '../helpers';
import { setExtensionContext } from '../../src/vscode/workspace-state';
import { clearParseCache } from '../../src/vscode/document-cache';
import { DecorationController } from '../../src/vscode/decoration-controller';
import { tagDecoration } from '../../src/features/decorations/decoration-tag';
import { dateDecoration } from '../../src/features/decorations/decoration-date';
import { mentionDecoration } from '../../src/features/decorations/decoration-mention';
import { projectDecoration } from '../../src/features/decorations/decoration-project';
import { dimDecoration } from '../../src/features/focus/decoration-dim';

// ── Wiring: bind the five decoration surfaces under test. ──────────────────
// This table was written against the pre-controller per-module functions and
// swapped to the DecorationController instances when Phase 3b landed; the
// pinned expectations below are unchanged from the pre-refactor originals.
interface Surface {
    full: (editor: vscode.TextEditor) => void;
    incremental: (
        editor: vscode.TextEditor,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ) => void;
    clear: () => void;
}
function controllerSurface(controller: DecorationController): Surface {
    return {
        full: (editor) => {
            controller.update(editor);
        },
        incremental: (editor, changes) => {
            controller.updateIncremental(editor, changes);
        },
        clear: () => {
            controller.clearCache();
        },
    };
}
const surfaces: Record<'tag' | 'date' | 'mention' | 'project' | 'dim', Surface> = {
    tag: controllerSurface(tagDecoration),
    date: controllerSurface(dateDecoration),
    mention: controllerSurface(mentionDecoration),
    project: controllerSurface(projectDecoration),
    dim: controllerSurface(dimDecoration),
};
// ───────────────────────────────────────────────────────────────────────────

const FIXTURE = [
    '---', // 0
    'md-todo: true', // 1
    '---', // 2
    '', // 3
    '# TODO', // 4
    '', // 5
    '## Active', // 6
    '', // 7
    '- [ ] Fix login flow `+2026-07-01` #auth @alice `[webapp]`', // 8
    '  - [ ] Refactor session store `+2026-07-02` @bob #auth', // 9
    '  - Investigated cookie expiry `+2026-07-02`', // 10
    '- [ ] Update onboarding docs `+2026-07-03` #docs', // 11
    '- [x] Ship v1 `+2026-06-20` `✓2026-07-03` @alice `[webapp]`', // 12
    '', // 13
    '## Completed', // 14
    '', // 15
    '- [x] Draft rollout plan `+2026-06-28` `✓2026-07-01` @bob `[tools]`', // 16
    '', // 17
    '## Users', // 18
    '', // 19
    '**alice** (Alice Smith): frontend', // 20
    '**bob** (Bob Jones): backend', // 21
    '', // 22
    '## Tags', // 23
    '', // 24
    '**auth**: authentication work', // 25
].join('\n');

const NON_TODO = ['# Just notes', '', '- [ ] looks like a todo #tag @user'].join('\n');

/** Serialize an emitted decoration list (Range[] or DecorationOptions[]). */
function ser(list: readonly (vscode.Range | vscode.DecorationOptions)[]): string[] {
    return list.map((entry) => {
        const r = 'range' in entry ? entry.range : entry;
        return `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
    });
}

/** Fake editor that records every setDecorations emission. */
function makeEditor(doc: vscode.TextDocument): {
    editor: vscode.TextEditor;
    emissions: (vscode.Range | vscode.DecorationOptions)[][];
} {
    const emissions: (vscode.Range | vscode.DecorationOptions)[][] = [];
    const editor = {
        document: doc,
        setDecorations: (
            _type: vscode.TextEditorDecorationType,
            options: (vscode.Range | vscode.DecorationOptions)[]
        ) => {
            emissions.push(options);
        },
    } as unknown as vscode.TextEditor;
    return { editor, emissions };
}

function lastEmission(emissions: (vscode.Range | vscode.DecorationOptions)[][]): string[] {
    expect(emissions.length).toBeGreaterThan(0);
    return ser(emissions[emissions.length - 1]);
}

function makeChange(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    text: string
): vscode.TextDocumentContentChangeEvent {
    return {
        range: new vscode.Range(startLine, startChar, endLine, endChar),
        rangeOffset: 0,
        rangeLength: 0,
        text,
    };
}

const focusStore = new Map<string, unknown>();

beforeEach(() => {
    focusStore.clear();
    setExtensionContext({
        workspaceState: {
            get: (key: string) => focusStore.get(key),
            update: (key: string, value: unknown) => {
                if (value === undefined) {
                    focusStore.delete(key);
                } else {
                    focusStore.set(key, value);
                }
                return Promise.resolve();
            },
        },
        subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    clearParseCache();
    for (const surface of Object.values(surfaces)) {
        surface.clear();
    }
});

describe('full scan (characterization)', () => {
    it('pins #tag ranges', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.tag.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:35-8:40",
            "9:50-9:55",
            "11:43-11:48",
          ]
        `);
    });

    it('pins `+date`/`✓date` ranges', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.date.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:21-8:34",
            "9:31-9:44",
            "10:31-10:44",
            "11:29-11:42",
            "12:14-12:27",
            "12:28-12:41",
            "16:25-16:38",
            "16:39-16:52",
          ]
        `);
    });

    it('pins @mention ranges', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.mention.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:41-8:47",
            "9:45-9:49",
            "12:42-12:48",
            "16:53-16:57",
          ]
        `);
    });

    it('pins `[project]` ranges', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.project.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:48-8:58",
            "12:49-12:59",
            "16:58-16:67",
          ]
        `);
    });

    it('emits an empty set for every surface on a non-todo file', () => {
        for (const surface of Object.values(surfaces)) {
            const { editor, emissions } = makeEditor(makeDoc(NON_TODO));
            surface.full(editor);
            expect(lastEmission(emissions)).toEqual([]);
        }
    });
});

describe('dim (characterization)', () => {
    it('pins dim ranges for a user-focus scenario (@alice)', () => {
        focusStore.set('mdTodo.focusUser', 'alice');
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.dim.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "11:0-11:48",
            "16:0-17:0",
            "9:45-9:49",
            "16:53-16:57",
          ]
        `);
    });

    it('pins dim ranges for a project-focus scenario ([webapp], with inheritance)', () => {
        focusStore.set('mdTodo.focusProject', 'webapp');
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.dim.full(editor);
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "11:0-11:48",
            "16:0-17:0",
            "16:58-16:67",
          ]
        `);
    });

    it('emits an empty set when no focus is set', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.dim.full(editor);
        expect(lastEmission(emissions)).toEqual([]);
    });

    it('short-circuits the incremental path when no focus is set and empty was already emitted', () => {
        const doc = makeDoc(FIXTURE, 'untitled:dim-short-circuit');
        const { editor, emissions } = makeEditor(doc);
        // First incremental emission on a no-focus doc records the empty set…
        surfaces.dim.incremental(editor, [makeChange(8, 0, 8, 0, 'x')]);
        expect(emissions).toHaveLength(1);
        expect(ser(emissions[0])).toEqual([]);
        // …after which further no-focus edits skip setDecorations entirely.
        surfaces.dim.incremental(editor, [makeChange(9, 0, 9, 0, 'y')]);
        expect(emissions).toHaveLength(1);
    });

    it('falls back to a full scan on edit when focus is set', () => {
        focusStore.set('mdTodo.focusUser', 'alice');
        const uri = 'untitled:dim-focused-edit';
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        surfaces.dim.full(e1);

        // Delete "@alice" from the Ship v1 line (line 12, cols 42–49 incl. space).
        const afterText = FIXTURE.replace(
            '- [x] Ship v1 `+2026-06-20` `✓2026-07-03` @alice `[webapp]`',
            '- [x] Ship v1 `+2026-06-20` `✓2026-07-03` `[webapp]`'
        );
        const after = makeDoc(afterText, uri);
        const { editor: e2, emissions } = makeEditor(after);
        surfaces.dim.incremental(e2, [makeChange(12, 42, 12, 49, '')]);

        // Must equal a fresh full scan of the post-edit document.
        const { editor: e3, emissions: fullEmissions } = makeEditor(makeDoc(afterText));
        surfaces.dim.full(e3);
        expect(lastEmission(emissions)).toEqual(lastEmission(fullEmissions));
    });
});

describe('incremental edit path (characterization)', () => {
    const uri = 'untitled:incremental';

    it('single-line insertion: shifted cache + rescan equals a fresh full scan', () => {
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        surfaces.tag.full(e1);

        // Insert a new todo line after line 11.
        const lines = FIXTURE.split('\n');
        lines.splice(12, 0, '- [ ] Rotate signing keys #security #auth');
        const afterText = lines.join('\n');
        const after = makeDoc(afterText, uri);
        const { editor: e2, emissions } = makeEditor(after);
        surfaces.tag.incremental(e2, [
            makeChange(11, lines[11].length, 11, lines[11].length, '\n' + lines[12]),
        ]);

        const { editor: e3, emissions: fullEmissions } = makeEditor(makeDoc(afterText));
        surfaces.tag.full(e3);
        expect(lastEmission(emissions)).toEqual(lastEmission(fullEmissions));
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:35-8:40",
            "9:50-9:55",
            "11:43-11:48",
            "12:26-12:35",
            "12:36-12:41",
          ]
        `);
    });

    it('multi-line deletion: shifted cache + rescan equals a fresh full scan', () => {
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        surfaces.mention.full(e1);

        // Delete lines 9–10 (the child todo and its note).
        const lines = FIXTURE.split('\n');
        lines.splice(9, 2);
        const afterText = lines.join('\n');
        const after = makeDoc(afterText, uri);
        const { editor: e2, emissions } = makeEditor(after);
        surfaces.mention.incremental(e2, [makeChange(9, 0, 11, 0, '')]);

        const { editor: e3, emissions: fullEmissions } = makeEditor(makeDoc(afterText));
        surfaces.mention.full(e3);
        expect(lastEmission(emissions)).toEqual(lastEmission(fullEmissions));
        expect(lastEmission(emissions)).toMatchInlineSnapshot(`
          [
            "8:41-8:47",
            "10:42-10:48",
            "14:53-14:57",
          ]
        `);
    });

    it('first edit on an uncached URI falls through to the full path', () => {
        const doc = makeDoc(FIXTURE, 'untitled:uncached');
        const { editor, emissions } = makeEditor(doc);
        surfaces.project.incremental(editor, [makeChange(8, 0, 8, 0, 'x')]);
        const { editor: e2, emissions: fullEmissions } = makeEditor(makeDoc(FIXTURE));
        surfaces.project.full(e2);
        expect(lastEmission(emissions)).toEqual(lastEmission(fullEmissions));
    });
});
