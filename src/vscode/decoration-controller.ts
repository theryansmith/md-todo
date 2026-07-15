import * as vscode from 'vscode';
import { isTodoFile } from './document-cache';
import { registerUriCache } from './cache-registry';

/**
 * One decoration lifecycle, five instances (F-03). A DecorationSpec describes
 * WHAT a decoration highlights; the DecorationController owns everything the
 * five hand-cloned modules used to duplicate: the TextEditorDecorationType
 * singleton (lazily created, re-creatable on config change, disposed with the
 * extension — F-12), the per-URI cache of the last emitted options (registered
 * with the CacheRegistry — F-11), the full-scan path, and the shared
 * incremental shift/re-scan path.
 *
 * Two spec shapes exist, discriminated by `incremental`:
 *
 * - `incremental: true` (tag, date, mention, project): per-line token scans
 *   whose emitted ranges live on a single line. On edit, the controller
 *   shifts the cached options past the edit and re-scans only the affected
 *   lines.
 * - `incremental: false` (dim): whole-document semantics (multi-line subtree
 *   ranges anchored to the parse) that cannot be shifted safely. On edit the
 *   controller falls back to a full scan — except when `isEmptyState()`
 *   reports the set is trivially empty (no focus set), where an
 *   already-empty cache entry lets it skip setDecorations entirely.
 */
interface DecorationSpecBase {
    readonly id: string;
    /**
     * Build the TextEditorDecorationType. Called lazily on first use and
     * again by recreateType() when a config key it depends on changes.
     */
    createType(): vscode.TextEditorDecorationType;
    /** Configuration keys whose change requires rebuilding the type. */
    readonly configKeys?: readonly string[];
}

export interface LineDecorationSpec extends DecorationSpecBase {
    readonly incremental: true;
    /** Options for one line. Every returned range must stay on that line. */
    scanLine(text: string, line: number): vscode.DecorationOptions[];
}

export interface DocumentDecorationSpec extends DecorationSpecBase {
    readonly incremental: false;
    /** Full recompute. Called only for opted-in todo documents. */
    scanDocument(document: vscode.TextDocument): vscode.DecorationOptions[];
    /**
     * True when current state guarantees an empty set regardless of document
     * content (dim: no focus dimension set). Enables the documented
     * incremental short-circuit.
     */
    isEmptyState(): boolean;
}

export type DecorationSpec = LineDecorationSpec | DocumentDecorationSpec;

/**
 * Build a scanLine implementation that decorates every match of a token
 * pattern. `pattern` must be a global regex (matchAll requirement).
 */
export function tokenScanLine(
    pattern: RegExp
): (text: string, line: number) => vscode.DecorationOptions[] {
    return (text, line) => {
        const options: vscode.DecorationOptions[] = [];
        for (const match of text.matchAll(pattern)) {
            // matchAll results always carry a numeric .index
            options.push({
                range: new vscode.Range(line, match.index, line, match.index + match[0].length),
            });
        }
        return options;
    };
}

export class DecorationController implements vscode.Disposable {
    private type: vscode.TextEditorDecorationType | undefined;

    // Cached per-URI emitted decoration list. The list always reflects the
    // most recent setDecorations call for that URI. Cleared on document close
    // via the CacheRegistry (see extension.ts wiring).
    private readonly cache = new Map<string, vscode.DecorationOptions[]>();

    constructor(private readonly spec: DecorationSpec) {
        registerUriCache((uri) => {
            this.clearCache(uri);
        });
    }

    /** The spec id, exposed for diagnostics/tests. */
    get id(): string {
        return this.spec.id;
    }

    clearCache(uri?: vscode.Uri): void {
        if (uri) {
            this.cache.delete(uri.toString());
        } else {
            this.cache.clear();
        }
    }

    /** Does this decoration's type depend on a config key this event touched? */
    affectsConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
        return (this.spec.configKeys ?? []).some((key) => event.affectsConfiguration(key));
    }

    /** Rebuild the decoration type (disposing the old one) after a config change. */
    recreateType(): void {
        this.type?.dispose();
        this.type = this.spec.createType();
    }

    dispose(): void {
        this.type?.dispose();
        this.type = undefined;
        this.cache.clear();
    }

    private getType(): vscode.TextEditorDecorationType {
        this.type ??= this.spec.createType();
        return this.type;
    }

    private scanLineRange(
        spec: LineDecorationSpec,
        document: vscode.TextDocument,
        startLine: number,
        endLine: number
    ): vscode.DecorationOptions[] {
        const options: vscode.DecorationOptions[] = [];
        const lo = Math.max(0, startLine);
        const hi = Math.min(document.lineCount - 1, endLine);
        for (let i = lo; i <= hi; i++) {
            options.push(...spec.scanLine(document.lineAt(i).text, i));
        }
        return options;
    }

    /** Full scan: recompute and emit the complete option set for the editor. */
    update(editor: vscode.TextEditor): void {
        const type = this.getType();
        const key = editor.document.uri.toString();

        if (!isTodoFile(editor.document)) {
            editor.setDecorations(type, []);
            this.cache.set(key, []);
            return;
        }

        const options = this.spec.incremental
            ? this.scanLineRange(this.spec, editor.document, 0, editor.document.lineCount - 1)
            : this.spec.scanDocument(editor.document);
        editor.setDecorations(type, options);
        this.cache.set(key, options);
    }

    /**
     * Edit path. Line-incremental specs shift the cached options past each
     * change and re-scan only the affected new-document lines. Document-scan
     * specs fall back to a full scan, except that a known-empty set that was
     * already emitted skips the setDecorations call entirely.
     */
    updateIncremental(
        editor: vscode.TextEditor,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): void {
        const key = editor.document.uri.toString();

        if (!this.spec.incremental) {
            if (!isTodoFile(editor.document) || this.spec.isEmptyState()) {
                if (this.cache.get(key)?.length === 0) {
                    return;
                }
                editor.setDecorations(this.getType(), []);
                this.cache.set(key, []);
                return;
            }
            // Whole-document semantics (an edit can re-parent a subtree, move
            // a header, or change which items match) — recompute in full.
            // parseDocument is memoized, so this costs one parse + one O(N)
            // walk per edit.
            this.update(editor);
            return;
        }

        const cached = this.cache.get(key);
        if (!cached) {
            // First time seeing this URI — fall through to the full path so
            // we populate the cache.
            this.update(editor);
            return;
        }

        const type = this.getType();
        if (!isTodoFile(editor.document)) {
            editor.setDecorations(type, []);
            this.cache.set(key, []);
            return;
        }

        const shifted = applyChangesToCache(cached, changes);
        const rescanned: vscode.DecorationOptions[] = [];
        for (const change of changes) {
            const { startLine, endLine } = affectedNewLineRange(change);
            rescanned.push(...this.scanLineRange(this.spec, editor.document, startLine, endLine));
        }
        const merged = mergeAndSort(shifted, rescanned);
        editor.setDecorations(type, merged);
        this.cache.set(key, merged);
    }
}

// ── Incremental shift/re-scan machinery (absorbed from the former ──────────
//    features/decorations/decoration-incremental.ts)

// Net number of lines added (positive) or removed (negative) by a single
// content change. For a pure insert with no newlines this is 0. For an
// insert of N newlines into a single line, +N. For a delete that collapses
// N+1 lines into 1, -N. Replacement of M lines with text containing K
// newlines is K - M.
function computeLineDelta(change: vscode.TextDocumentContentChangeEvent): number {
    const newlinesInText = change.text.match(/\n/g)?.length ?? 0;
    const oldLineSpan = change.range.end.line - change.range.start.line;
    return newlinesInText - oldLineSpan;
}

/**
 * Update a cached decoration list to reflect a single edit, producing the
 * subset of options that survive unchanged (above the edit) or shifted (below
 * the edit). Options whose start line falls inside [dropStartLine, dropEndLine]
 * are dropped — callers must re-scan that range against the post-edit document
 * and merge the new options back in.
 *
 * All line numbers are in OLD-document coordinates (before the edit was
 * applied). The returned options carry NEW-document line numbers (above-the-
 * edit options are unchanged; below-the-edit options have line numbers shifted
 * by `delta`).
 *
 * Single-line decoration patterns only: each DecorationOptions range is
 * assumed to live on a single line (start.line === end.line) — the
 * LineDecorationSpec contract.
 */
function dropAndShift(
    options: vscode.DecorationOptions[],
    dropStartLine: number,
    dropEndLine: number,
    delta: number
): vscode.DecorationOptions[] {
    const result: vscode.DecorationOptions[] = [];
    for (const opt of options) {
        const startLine = opt.range.start.line;
        if (startLine < dropStartLine) {
            // Above the edit — unchanged.
            result.push(opt);
        } else if (startLine > dropEndLine) {
            // Below the edit — shift line numbers by delta.
            if (delta === 0) {
                result.push(opt);
            } else {
                const newStart = new vscode.Position(
                    opt.range.start.line + delta,
                    opt.range.start.character
                );
                const newEnd = new vscode.Position(
                    opt.range.end.line + delta,
                    opt.range.end.character
                );
                result.push({ ...opt, range: new vscode.Range(newStart, newEnd) });
            }
        }
        // else: inside [dropStartLine, dropEndLine] — drop, caller will re-scan.
    }
    return result;
}

/**
 * Apply a sequence of content changes to a cached decoration list, working
 * right-to-left so each change's coordinates remain valid as we go. Returns
 * the surviving (above-the-edit, untouched) plus shifted (below-the-edit)
 * options. For each change the caller must also re-scan the affected NEW
 * line range — see affectedNewLineRange below.
 *
 * VS Code does not guarantee any ordering on `event.contentChanges`. In
 * practice it returns them in document order (and the docs hint at that),
 * but we sort defensively here. Right-to-left = descending by range.start.
 */
function applyChangesToCache(
    cached: vscode.DecorationOptions[],
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): vscode.DecorationOptions[] {
    const sorted = [...changes].sort((a, b) => {
        if (b.range.start.line !== a.range.start.line) {
            return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
    });

    let working = cached;
    for (const change of sorted) {
        const delta = computeLineDelta(change);
        working = dropAndShift(working, change.range.start.line, change.range.end.line, delta);
    }
    return working;
}

/**
 * For a content change, return the [startLine, endLine] inclusive range of
 * NEW-document lines that need re-scanning. This is the post-edit footprint
 * of the change: `change.range.start.line` to `change.range.start.line +
 * newlinesInText`. Always at least one line.
 */
function affectedNewLineRange(change: vscode.TextDocumentContentChangeEvent): {
    startLine: number;
    endLine: number;
} {
    const newlinesInText = change.text.match(/\n/g)?.length ?? 0;
    const startLine = change.range.start.line;
    return { startLine, endLine: startLine + newlinesInText };
}

/**
 * Merge re-scanned options (covering one or more affected ranges in the new
 * document) into the shifted cache. Returns a fresh array sorted by start
 * line then start character. VS Code does not require sorted input but keeping
 * a canonical order makes the cache deterministic and easier to reason about.
 */
function mergeAndSort(
    shifted: vscode.DecorationOptions[],
    rescanned: vscode.DecorationOptions[]
): vscode.DecorationOptions[] {
    const merged = shifted.concat(rescanned);
    merged.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
    });
    return merged;
}
