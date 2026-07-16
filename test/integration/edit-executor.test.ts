import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { WorkspaceEdit, workspace, window } from '../mocks/vscode';
import { makeDoc } from '../helpers';
import { applyPlan } from '../../src/vscode/edit-executor';
import { EditPlan } from '../../src/core/edit/plans';

/**
 * The edit-executor's contract (F-07): every plan op lands in ONE
 * WorkspaceEdit passed to a single workspace.applyEdit call, with the
 * whole-line ops mapped to the exact ranges/positions the golden-test
 * string-array applier models — including the end-of-document branches.
 */

const DOC = ['## Active', '', '- [ ] one', '- [ ] two', '## Completed'].join('\n');

function lastEdit(): WorkspaceEdit {
    expect(workspace.appliedEdits.length).toBeGreaterThan(0);
    return workspace.appliedEdits[workspace.appliedEdits.length - 1];
}

describe('applyPlan', () => {
    beforeEach(() => {
        workspace.appliedEdits.length = 0;
    });

    it('applies all ops in one WorkspaceEdit / one applyEdit call and shows the summary', async () => {
        const doc = makeDoc(DOC);
        const info = vi.spyOn(window, 'showInformationMessage');
        const plan: EditPlan = {
            ops: [
                { kind: 'deleteLines', startLine: 2, endLine: 2 },
                { kind: 'insertLines', atLine: 4, lines: ['- [x] one'] },
            ],
            summary: 'Completed: one',
        };
        const applied = await applyPlan(doc, plan);
        expect(applied).toBe(true);
        expect(workspace.appliedEdits).toHaveLength(1);
        expect(lastEdit().ops).toHaveLength(2);
        expect(info).toHaveBeenCalledWith('Completed: one');
        info.mockRestore();
    });

    it('replaceLines → full-line replace range ending at the last line character', async () => {
        const doc = makeDoc(DOC);
        await applyPlan(doc, {
            ops: [
                {
                    kind: 'replaceLines',
                    startLine: 2,
                    endLine: 3,
                    lines: ['- [x] one', '- [x] two'],
                },
            ],
            summary: 's',
        });
        const op = lastEdit().ops[0];
        expect(op).toMatchObject({ kind: 'replace', newText: '- [x] one\n- [x] two' });
        if (op.kind !== 'replace') throw new Error('unreachable');
        expect(op.range.start).toMatchObject({ line: 2, character: 0 });
        expect(op.range.end).toMatchObject({ line: 3, character: '- [ ] two'.length });
    });

    it('deleteLines mid-document → [start,0)..(end+1,0) newline-inclusive range', async () => {
        const doc = makeDoc(DOC);
        await applyPlan(doc, {
            ops: [{ kind: 'deleteLines', startLine: 2, endLine: 3 }],
            summary: 's',
        });
        const op = lastEdit().ops[0];
        if (op.kind !== 'delete') throw new Error('expected delete');
        expect(op.range.start).toMatchObject({ line: 2, character: 0 });
        expect(op.range.end).toMatchObject({ line: 4, character: 0 });
    });

    it('deleteLines reaching the last line → consumes the preceding newline instead', async () => {
        const doc = makeDoc(DOC);
        await applyPlan(doc, {
            ops: [{ kind: 'deleteLines', startLine: 4, endLine: 4 }],
            summary: 's',
        });
        const op = lastEdit().ops[0];
        if (op.kind !== 'delete') throw new Error('expected delete');
        expect(op.range.start).toMatchObject({ line: 3, character: '- [ ] two'.length });
        expect(op.range.end).toMatchObject({ line: 4, character: '## Completed'.length });
    });

    it('insertLines before an existing line → insert at (line, 0) with a trailing newline', async () => {
        const doc = makeDoc(DOC);
        await applyPlan(doc, {
            ops: [{ kind: 'insertLines', atLine: 2, lines: ['- [ ] zero', ''] }],
            summary: 's',
        });
        const op = lastEdit().ops[0];
        if (op.kind !== 'insert') throw new Error('expected insert');
        expect(op.position).toMatchObject({ line: 2, character: 0 });
        expect(op.newText).toBe('- [ ] zero\n\n');
    });

    it('insertLines at/after lineCount → append after the last line with a leading newline', async () => {
        const doc = makeDoc(DOC);
        await applyPlan(doc, {
            ops: [{ kind: 'insertLines', atLine: 5, lines: ['- [x] moved', ''] }],
            summary: 's',
        });
        const op = lastEdit().ops[0];
        if (op.kind !== 'insert') throw new Error('expected insert');
        expect(op.position).toMatchObject({ line: 4, character: '## Completed'.length });
        expect(op.newText).toBe('\n- [x] moved\n');
    });

    it('targets the document uri on every op', async () => {
        const doc = makeDoc(DOC, 'file:///todo.md');
        await applyPlan(doc, {
            ops: [
                { kind: 'deleteLines', startLine: 2, endLine: 2 },
                { kind: 'insertLines', atLine: 4, lines: ['x'] },
            ],
            summary: 's',
        });
        for (const op of lastEdit().ops) {
            expect((op.uri as vscode.Uri).toString()).toBe('file:///todo.md');
        }
    });
});
