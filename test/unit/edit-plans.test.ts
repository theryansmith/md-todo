import { describe, it, expect } from 'vitest';
import { parseDocument } from '../../src/core/parse/parser';
import { findItemByLine } from '../../src/core/query/items';
import { buildMarkDonePlan, buildArchivePlan, EditPlan, EditOp } from '../../src/core/edit/plans';
import { makeDoc } from './helpers';

/**
 * Golden tests for the EditPlan builders (F-07). Every expected document
 * below was derived by hand-tracing the PRE-plan implementations
 * (`markItemDone`'s four cases with its delete → re-parse → insert two-step,
 * and `archiveItems`'s single multi-op edit) — the old behavior is the spec.
 * The plan is applied to a plain string array with the same whole-line
 * semantics the vscode edit-executor uses, and the final text is compared.
 */

const TODAY = '2026-07-15';
const ARCHIVE_TODAY = new Date(2026, 6, 15); // local 2026-07-15

/**
 * Apply a plan to a document given as lines. Ops are in original-document
 * coordinates and non-overlapping, so they apply in descending position
 * order; on a position tie (an insert at the first line of a deleted block,
 * e.g. re-archiving the top archive item) the delete applies first — matching
 * how VS Code merges a zero-width insert at a delete-range start.
 */
function applyPlan(lines: readonly string[], plan: EditPlan): string[] {
    const result = [...lines];
    const pos = (op: EditOp) => (op.kind === 'insertLines' ? op.atLine : op.startLine);
    const rank = (op: EditOp) => (op.kind === 'insertLines' ? 1 : 0);
    const ops = [...plan.ops].sort((a, b) => pos(b) - pos(a) || rank(a) - rank(b));
    for (const op of ops) {
        if (op.kind === 'replaceLines') {
            result.splice(op.startLine, op.endLine - op.startLine + 1, ...op.lines);
        } else if (op.kind === 'deleteLines') {
            result.splice(op.startLine, op.endLine - op.startLine + 1);
        } else if (op.atLine >= result.length) {
            result.push(...op.lines);
        } else {
            result.splice(op.atLine, 0, ...op.lines);
        }
    }
    return result;
}

function markDoneResult(lines: string[], itemLine: number): { plan: EditPlan; out: string[] } {
    const doc = makeDoc(lines.join('\n'));
    const parsed = parseDocument(doc);
    const item = findItemByLine(parsed.items, itemLine);
    expect(item, `no item on line ${itemLine}`).toBeTruthy();
    const plan = buildMarkDonePlan(doc, parsed, item!, TODAY);
    return { plan, out: applyPlan(lines, plan) };
}

function opsAreNonOverlapping(plan: EditPlan): boolean {
    const ranges = plan.ops.map((op) =>
        op.kind === 'insertLines'
            ? { start: op.atLine, end: op.atLine - 1 } // zero-width
            : { start: op.startLine, end: op.endLine }
    );
    ranges.sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].start <= ranges[i - 1].end) {
            return false;
        }
    }
    return true;
}

const FRONT = ['---', 'md-todo: true', '---', ''];

describe('buildMarkDonePlan — the four-case matrix', () => {
    it('CASE 1: nested item marks its subtree in place (never moves, even with a Completed section)', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] parent `+2026-07-01`',
            '    - [ ] child task `+2026-07-02`',
            '        - [ ] grandchild',
            '        - child note',
            '- [ ] sibling',
            '',
            '## Completed',
            '',
        ];
        const { plan, out } = markDoneResult(lines, 7); // child task
        expect(plan.summary).toBe('Completed: child task');
        expect(plan.ops).toEqual([
            {
                kind: 'replaceLines',
                startLine: 7,
                endLine: 9,
                lines: [
                    '    - [x] child task `+2026-07-02` `✓2026-07-15`',
                    '        - [x] grandchild `✓2026-07-15`',
                    '        - child note',
                ],
            },
        ]);
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '- [ ] parent `+2026-07-01`',
            '    - [x] child task `+2026-07-02` `✓2026-07-15`',
            '        - [x] grandchild `✓2026-07-15`',
            '        - child note',
            '- [ ] sibling',
            '',
            '## Completed',
            '',
        ]);
    });

    it('CASE 2: no Completed section — top-level item marks in place', () => {
        const lines = [...FRONT, '## Active', '', '- [ ] solo task `+2026-07-01`', ''];
        const { plan, out } = markDoneResult(lines, 6);
        expect(plan.summary).toBe('Completed: solo task');
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '- [x] solo task `+2026-07-01` `✓2026-07-15`',
            '',
        ]);
    });

    it('CASE 3: incomplete item already inside the Completed section marks in place (no move)', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] active task',
            '',
            '## Completed',
            '',
            '- [ ] misplaced task `+2026-07-01`',
            '',
        ];
        const { plan, out } = markDoneResult(lines, 10);
        expect(plan.ops).toHaveLength(1);
        expect(plan.ops[0].kind).toBe('replaceLines');
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '- [ ] active task',
            '',
            '## Completed',
            '',
            '- [x] misplaced task `+2026-07-01` `✓2026-07-15`',
            '',
        ]);
    });

    it('CASE 4: top-level item above Completed moves (with marked children and notes) below the header blank line', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] ship feature `+2026-07-01`',
            '    - [ ] subtask',
            '    - a note',
            '- [ ] other task',
            '',
            '## Completed',
            '',
            '- [x] old done `✓2026-07-10`',
            '',
        ];
        const { plan, out } = markDoneResult(lines, 6);
        expect(plan.summary).toBe('Completed: ship feature');
        expect(opsAreNonOverlapping(plan)).toBe(true);
        // The item (lines 6-8) sits ABOVE the Completed header (line 11): the
        // old code deleted 3 lines, re-parsed, and saw the section start at
        // 11 - 3 = 8, inserting after its blank at post-delete line 10 — which
        // is original line 13. The plan computes the same landing spot from
        // the single original snapshot.
        expect(plan.ops).toEqual([
            { kind: 'deleteLines', startLine: 6, endLine: 8 },
            {
                kind: 'insertLines',
                atLine: 13,
                lines: [
                    '- [x] ship feature `+2026-07-01` `✓2026-07-15`',
                    '    - [x] subtask `✓2026-07-15`',
                    '    - a note',
                ],
            },
        ]);
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '- [ ] other task',
            '',
            '## Completed',
            '',
            '- [x] ship feature `+2026-07-01` `✓2026-07-15`',
            '    - [x] subtask `✓2026-07-15`',
            '    - a note',
            '- [x] old done `✓2026-07-10`',
            '',
        ]);
    });

    it('CASE 4: no blank line after the Completed header — one is created before the item', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] move me `+2026-07-01`',
            '',
            '## Completed',
            '- [x] existing `✓2026-07-10`',
            '',
        ];
        // The item block includes its trailing blank line (line 7), exactly
        // like the old getItemWithDescendantsEndLine-based delete did.
        const { plan, out } = markDoneResult(lines, 6);
        expect(opsAreNonOverlapping(plan)).toBe(true);
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '## Completed',
            '',
            '- [x] move me `+2026-07-01` `✓2026-07-15`',
            '',
            '- [x] existing `✓2026-07-10`',
            '',
        ]);
    });

    it('CASE 4: item BELOW the Completed section — the deletion does not shift the header', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [x] done thing `✓2026-07-10`',
            '',
            '## Active',
            '',
            '- [ ] late task `+2026-07-01`',
            '',
        ];
        const { plan, out } = markDoneResult(lines, 10);
        // Header at line 4 is untouched by the deletion at lines 10-11, so
        // the insert lands directly at original line 6 (start + 2).
        expect(plan.ops).toContainEqual({
            kind: 'insertLines',
            atLine: 6,
            lines: ['- [x] late task `+2026-07-01` `✓2026-07-15`', ''],
        });
        // The item's block (line 10 + its trailing blank line 11) reaches the
        // end of the document, so the old clamped delete left one empty line
        // behind — pinned here.
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '- [x] late task `+2026-07-01` `✓2026-07-15`',
            '',
            '- [x] done thing `✓2026-07-10`',
            '',
            '## Active',
            '',
            '',
        ]);
    });

    it('CASE 4: Completed header is the last line of the document (old end-of-document clamp appended after it)', () => {
        const lines = [...FRONT, '## Active', '', '- [ ] tail task', '', '## Completed'];
        const { plan, out } = markDoneResult(lines, 6);
        expect(opsAreNonOverlapping(plan)).toBe(true);
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '## Completed',
            '- [x] tail task `✓2026-07-15`',
            '',
            '',
        ]);
    });

    it('CASE 4: header + blank line end the document — old clamp landed the item BEFORE the blank', () => {
        const lines = [...FRONT, '## Active', '', '- [ ] last active', '', '## Completed', ''];
        const { plan, out } = markDoneResult(lines, 6);
        expect(opsAreNonOverlapping(plan)).toBe(true);
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '## Completed',
            '- [x] last active `✓2026-07-15`',
            '',
            '',
        ]);
    });

    it('CASE 4: item block reaching the end of a newline-less document leaves one empty line behind (old delete clamp)', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [x] done `✓2026-07-10`',
            '',
            '## Active',
            '',
            '- [ ] eof task',
        ];
        const { plan, out } = markDoneResult(lines, 10);
        expect(opsAreNonOverlapping(plan)).toBe(true);
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '- [x] eof task `✓2026-07-15`',
            '- [x] done `✓2026-07-10`',
            '',
            '## Active',
            '',
            '',
        ]);
    });

    it('marks only checkbox lines inside the block; already-completed children keep their date', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] mixed parent `+2026-07-01`',
            '    - [x] finished child `✓2026-07-02`',
            '    - plain note',
            '',
            '## Completed',
            '',
        ];
        const { out } = markDoneResult(lines, 6);
        // The moved block includes its trailing blank line, so post-delete the
        // header's blank is the LAST line — the old insert clamped to the end
        // of the document and the block landed directly after the header.
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '## Completed',
            '- [x] mixed parent `+2026-07-01` `✓2026-07-15`',
            '    - [x] finished child `✓2026-07-02`',
            '    - plain note',
            '',
            '',
        ]);
    });
});

describe('buildArchivePlan', () => {
    function archiveResult(
        lines: string[],
        archiveAfterDays = 7
    ): { plan: EditPlan | null; out: string[] | null } {
        const doc = makeDoc(lines.join('\n'));
        const parsed = parseDocument(doc);
        const plan = buildArchivePlan(doc, parsed, { archiveAfterDays, today: ARCHIVE_TODAY });
        return { plan, out: plan ? applyPlan(lines, plan) : null };
    }

    it('moves every eligible block (notes included, document order) to the top of the Archive section', () => {
        const lines = [
            ...FRONT,
            '## Active',
            '',
            '- [ ] wip task',
            '',
            '## Completed',
            '',
            '- [x] old one `+2026-06-20` `✓2026-07-01`',
            '    - detail note',
            '- [x] fresh one `✓2026-07-14`',
            '- [x] old two `✓2026-07-05`',
            '',
            '## Archive',
            '',
            '- [x] ancient `✓2026-05-01`',
            '',
        ];
        const { plan, out } = archiveResult(lines);
        expect(plan?.summary).toBe('Archived 3 items');
        expect(plan && opsAreNonOverlapping(plan)).toBe(true);
        // Old behavior quirks pinned deliberately: (1) "old two"'s block
        // carries the blank line separating it from "## Archive", so the
        // Completed section loses that separator; (2) "ancient" already lives
        // in the Archive and is old enough, so it is re-archived to the top
        // region too; (3) its end-of-document block leaves the final empty
        // line behind (old per-line delete clamped at the document end).
        expect(out).toEqual([
            ...FRONT,
            '## Active',
            '',
            '- [ ] wip task',
            '',
            '## Completed',
            '',
            '- [x] fresh one `✓2026-07-14`',
            '## Archive',
            '',
            '- [x] old one `+2026-06-20` `✓2026-07-01`',
            '    - detail note',
            '- [x] old two `✓2026-07-05`',
            '',
            '- [x] ancient `✓2026-05-01`',
            '',
            '',
            '',
        ]);
    });

    it('threshold is inclusive: exactly archiveAfterDays old is archived, one day fresher is not', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [x] boundary `✓2026-07-08`', // exactly 7 days before 2026-07-15
            '- [x] fresher `✓2026-07-09`', // 6 days
            '',
            '## Archive',
            '',
        ];
        const { plan, out } = archiveResult(lines, 7);
        expect(plan?.summary).toBe('Archived 1 items');
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '- [x] fresher `✓2026-07-09`',
            '',
            '## Archive',
            '',
            '- [x] boundary `✓2026-07-08`',
            '',
        ]);
    });

    it('creates the Archive section at the end of the document when missing', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [x] old task `✓2026-07-01`',
            '- [x] recent `✓2026-07-14`',
            '',
        ];
        const { out } = archiveResult(lines);
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '- [x] recent `✓2026-07-14`',
            '',
            '## Archive',
            '',
            '- [x] old task `✓2026-07-01`',
            '',
        ]);
    });

    it('Archive header as the last document line: block appended after it with a trailing blank', () => {
        const lines = [...FRONT, '## Completed', '', '- [x] old `✓2026-07-01`', '', '## Archive'];
        const { out } = archiveResult(lines);
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '## Archive',
            '- [x] old `✓2026-07-01`',
            '',
            '',
        ]);
    });

    it('re-archiving the item directly below the Archive header (insert and delete meet at one line)', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [x] old `✓2026-07-01`',
            '',
            '## Archive',
            '- [x] ancient `✓2026-05-01`',
            '',
        ];
        const { plan, out } = archiveResult(lines);
        expect(plan?.summary).toBe('Archived 2 items');
        expect(out).toEqual([
            ...FRONT,
            '## Completed',
            '',
            '## Archive',
            '',
            '- [x] old `✓2026-07-01`',
            '',
            '- [x] ancient `✓2026-05-01`',
            '',
            '',
        ]);
    });

    it('returns null when nothing is old enough (incomplete and undated items never qualify)', () => {
        const lines = [
            ...FRONT,
            '## Completed',
            '',
            '- [ ] not done `+2026-06-01`',
            '- [x] undated done',
            '- [x] recent `✓2026-07-14`',
            '',
            '## Archive',
            '',
        ];
        const { plan } = archiveResult(lines);
        expect(plan).toBeNull();
    });
});
