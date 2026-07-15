/**
 * F-17 decoration tests: token decorations skip lines inside fenced code
 * blocks and HTML comments on both the full-scan and incremental paths, and
 * the incremental path falls back to a full scan whenever the fence/comment
 * structure changes (marker text typed, or a marker line deleted).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeDoc } from '../helpers';
import { setExtensionContext } from '../../src/vscode/workspace-state';
import { clearParseCache } from '../../src/vscode/document-cache';
import { tagDecoration } from '../../src/features/decorations/decoration-tag';
import { mentionDecoration } from '../../src/features/decorations/decoration-mention';
import { dimDecoration } from '../../src/features/focus/decoration-dim';

const FIXTURE = [
    '---', // 0
    'md-todo: true', // 1
    '---', // 2
    '', // 3
    '## Active', // 4
    '', // 5
    '- [ ] Real task #real @dev', // 6
    '', // 7
    '```', // 8
    '- [ ] fake #fake @ghost', // 9
    '```', // 10
    '', // 11
    '<!--', // 12
    '#hidden @nobody', // 13
    '-->', // 14
    '', // 15
    '- [ ] Last real #tail', // 16
].join('\n');

function ser(list: readonly (vscode.Range | vscode.DecorationOptions)[]): string[] {
    return list.map((entry) => {
        const r = 'range' in entry ? entry.range : entry;
        return `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
    });
}

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

function last(emissions: (vscode.Range | vscode.DecorationOptions)[][]): string[] {
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
    tagDecoration.clearCache();
    mentionDecoration.clearCache();
    dimDecoration.clearCache();
});

describe('full scan skips fenced/commented lines (F-17)', () => {
    it('#tag decorations only on real lines', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        tagDecoration.update(editor);
        expect(last(emissions)).toEqual(['6:16-6:21', '16:16-16:21']);
    });

    it('@mention decorations only on real lines', () => {
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        mentionDecoration.update(editor);
        expect(last(emissions)).toEqual(['6:22-6:26']);
    });

    it('dim span-level token dimming skips fenced/commented lines', () => {
        focusStore.set('mdTodo.focusUser', 'dev');
        const { editor, emissions } = makeEditor(makeDoc(FIXTURE));
        dimDecoration.update(editor);
        // "Last real" has no @dev → its subtree line is dimmed; the @ghost /
        // @nobody tokens inside the fence and comment are NOT span-dimmed.
        expect(last(emissions)).toEqual(['16:0-16:21']);
    });
});

describe('incremental path (F-17)', () => {
    it('an edit on a line inside an existing fence stays token-free', () => {
        const uri = 'untitled:f17-inside-fence';
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        tagDecoration.update(e1);

        // Append " #more" to the fake line inside the fence (no fence
        // markers in the change; marker structure unchanged → incremental).
        const lines = FIXTURE.split('\n');
        lines[9] = '- [ ] fake #fake @ghost #more';
        const afterText = lines.join('\n');
        const { editor: e2, emissions } = makeEditor(makeDoc(afterText, uri));
        tagDecoration.updateIncremental(e2, [makeChange(9, 23, 9, 23, ' #more')]);
        expect(last(emissions)).toEqual(['6:16-6:21', '16:16-16:21']);
    });

    it('typing a fence opener (marker in change text) falls back to a full scan', () => {
        const uri = 'untitled:f17-typed-fence';
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        tagDecoration.update(e1);

        // Wrap the "Last real" line in a new fence typed above it.
        const lines = FIXTURE.split('\n');
        lines.splice(16, 0, '```');
        const afterText = lines.join('\n');
        const { editor: e2, emissions } = makeEditor(makeDoc(afterText, uri));
        tagDecoration.updateIncremental(e2, [makeChange(16, 0, 16, 0, '```\n')]);
        // The whole tail is now an (unclosed) fence — only line 6 remains.
        expect(last(emissions)).toEqual(['6:16-6:21']);
    });

    it('deleting a fence-delimiter line (no marker in change text) also falls back', () => {
        const uri = 'untitled:f17-deleted-fence';
        const before = makeDoc(FIXTURE, uri);
        const { editor: e1 } = makeEditor(before);
        tagDecoration.update(e1);

        // Delete the opening ``` line entirely: the change text is '' and
        // carries no marker — the marker-line COUNT signature catches it.
        const lines = FIXTURE.split('\n');
        lines.splice(8, 1);
        const afterText = lines.join('\n');
        const { editor: e2, emissions } = makeEditor(makeDoc(afterText, uri));
        tagDecoration.updateIncremental(e2, [makeChange(8, 0, 9, 0, '')]);

        // The old fence body is exposed; the old closing ``` opens a NEW
        // fence that swallows the rest of the file. Must equal a fresh
        // full scan of the post-edit document.
        const { editor: e3, emissions: fullEmissions } = makeEditor(makeDoc(afterText));
        tagDecoration.update(e3);
        expect(last(emissions)).toEqual(last(fullEmissions));
        expect(last(emissions)).toEqual(['6:16-6:21', '8:11-8:16']);
    });
});
