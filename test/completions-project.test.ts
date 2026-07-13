import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { projectCompletionProvider } from '../completions';
import { makeDoc } from './helpers';

// Todo-file fixture (frontmatter makes isTodoFile pass) with one defined
// project and three trigger lines exercising the `[`-consume range logic.
const FIXTURE = [
    '---',           // 0
    'md-todo: true', // 1
    '---',           // 2
    '',              // 3
    '# TODO',        // 4
    '',              // 5
    '## Active',     // 6
    '',              // 7
    '- [ ] task [',  // 8  — bare trigger at end of line
    '- [ ] task []', // 9  — editor auto-closed the bracket
    '- [ ] task [x', // 10 — non-bracket char follows the trigger
    '',              // 11
    '## Projects',   // 12
    '',              // 13
    '**game-x**: The big title', // 14
].join('\n');

async function complete(line: number, character: number): Promise<vscode.CompletionItem[]> {
    const doc = makeDoc(FIXTURE);
    const items = await projectCompletionProvider.provideCompletionItems(
        doc,
        new vscode.Position(line, character),
        undefined as unknown as vscode.CancellationToken,
        undefined as unknown as vscode.CompletionContext,
    );
    return items as vscode.CompletionItem[];
}

describe('projectCompletionProvider — range and insert-text logic', () => {
    it('consumes the typed `[`: replace range starts one char before the cursor', async () => {
        const items = await complete(8, 12); // cursor right after the typed `[`
        expect(items).toHaveLength(1);
        const item = items[0];
        expect(item.insertText).toBe('`[game-x]`'); // end of line → no trailing space
        const range = item.range as vscode.Range;
        expect(range.start.line).toBe(8);
        expect(range.start.character).toBe(11);
        expect(range.end.character).toBe(12);
    });

    it('swallows an auto-closed `]`: replace range extends one char past the cursor', async () => {
        const items = await complete(9, 12); // cursor between `[` and auto-closed `]`
        const item = items[0];
        const range = item.range as vscode.Range;
        expect(range.start.character).toBe(11);
        expect(range.end.character).toBe(13); // includes the `]`
        expect(item.insertText).toBe('`[game-x]`'); // nothing after the `]` → no trailing space
    });

    it('adds a trailing space when a non-whitespace char (not `]`) follows the cursor', async () => {
        const items = await complete(10, 12); // `x` follows the typed `[`
        const item = items[0];
        const range = item.range as vscode.Range;
        expect(range.start.character).toBe(11);
        expect(range.end.character).toBe(12); // no swallow — next char is not `]`
        expect(item.insertText).toBe('`[game-x]` ');
    });
});
