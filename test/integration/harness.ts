/**
 * Shared feature-test harness (Phase 5): an editable TextEditor fake whose
 * edit() actually applies insert/replace/delete operations to the backing
 * text (bumping the document version so the (uri, version) parse cache never
 * serves a stale parse), plus a scriptable QuickPick fake for the
 * promptForTodoText suggestion flow.
 */
import * as vscode from 'vscode';

let nextId = 1;

export interface EditableEditor {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
    /** Current document content lines. */
    lines(): string[];
    text(): string;
    /** Move the primary cursor. */
    setCursor(line: number, character: number): void;
}

interface PendingOp {
    start: number;
    end: number;
    text: string;
}

/**
 * Build a TextEditor fake over mutable text. lineAt() exposes `range` (used
 * by line-replacing commands) and edit() applies the collected operations
 * right-to-left by offset, mirroring how a real TextEditorEdit batch lands.
 */
export function makeEditableEditor(initialText: string, uri?: string): EditableEditor {
    let lines = initialText.split('\n');
    let version = 1;
    const uriString = uri ?? `untitled:editable-${nextId++}`;

    const offsetOf = (line: number, character: number): number => {
        let offset = 0;
        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset + character;
    };

    const document = {
        languageId: 'markdown',
        uri: { toString: () => uriString },
        get version() {
            return version;
        },
        get lineCount() {
            return lines.length;
        },
        lineAt(i: number) {
            return {
                text: lines[i],
                range: new vscode.Range(i, 0, i, lines[i].length),
            };
        },
    } as unknown as vscode.TextDocument;

    let selection = {
        active: new vscode.Position(0, 0),
        anchor: new vscode.Position(0, 0),
    };

    const editor = {
        document,
        get selection() {
            return selection;
        },
        edit(
            callback: (builder: vscode.TextEditorEdit) => void,
            _options?: unknown
        ): Promise<boolean> {
            const ops: PendingOp[] = [];
            const builder = {
                insert(position: vscode.Position, text: string) {
                    const at = offsetOf(position.line, position.character);
                    ops.push({ start: at, end: at, text });
                },
                replace(range: vscode.Range, text: string) {
                    ops.push({
                        start: offsetOf(range.start.line, range.start.character),
                        end: offsetOf(range.end.line, range.end.character),
                        text,
                    });
                },
                delete(range: vscode.Range) {
                    ops.push({
                        start: offsetOf(range.start.line, range.start.character),
                        end: offsetOf(range.end.line, range.end.character),
                        text: '',
                    });
                },
            } as unknown as vscode.TextEditorEdit;
            callback(builder);

            ops.sort((a, b) => b.start - a.start);
            let content = lines.join('\n');
            for (const op of ops) {
                content = content.slice(0, op.start) + op.text + content.slice(op.end);
            }
            lines = content.split('\n');
            version++;
            return Promise.resolve(true);
        },
        setDecorations: () => undefined,
    } as unknown as vscode.TextEditor;

    return {
        editor,
        document,
        lines: () => [...lines],
        text: () => lines.join('\n'),
        setCursor(line: number, character: number) {
            const pos = new vscode.Position(line, character);
            selection = { active: pos, anchor: pos };
        },
    };
}

/** Let pending promise chains (mocked showQuickPick, etc.) settle. */
export function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

type Handler<T> = (value: T) => unknown;

/**
 * Scriptable stand-in for window.createQuickPick(). Tests drive it with
 * type() / accept() / hide() and inspect items/value/placeholder.
 */
export class FakeQuickPick<T extends vscode.QuickPickItem> {
    title = '';
    placeholder = '';
    value = '';
    items: readonly T[] = [];
    activeItems: readonly T[] = [];
    matchOnDescription = true;
    matchOnDetail = true;
    matchOnLabel = true;
    sortByLabel = true;
    ignoreFocusOut = false;
    visible = false;
    disposed = false;

    private valueHandlers: Handler<string>[] = [];
    private acceptHandlers: Handler<void>[] = [];
    private hideHandlers: Handler<void>[] = [];

    onDidChangeValue = (h: Handler<string>) => {
        this.valueHandlers.push(h);
        return { dispose: () => undefined };
    };
    onDidAccept = (h: Handler<void>) => {
        this.acceptHandlers.push(h);
        return { dispose: () => undefined };
    };
    onDidHide = (h: Handler<void>) => {
        this.hideHandlers.push(h);
        return { dispose: () => undefined };
    };

    show(): void {
        this.visible = true;
    }
    hide(): void {
        this.visible = false;
        for (const h of this.hideHandlers) {
            h(undefined);
        }
    }
    dispose(): void {
        this.disposed = true;
    }

    // ── test drivers ──
    /** Simulate the user typing: sets value and fires onDidChangeValue. */
    type(value: string): void {
        this.value = value;
        for (const h of this.valueHandlers) {
            h(value);
        }
    }
    /** Simulate pressing Enter. */
    accept(): void {
        for (const h of this.acceptHandlers) {
            h(undefined);
        }
    }
}

/**
 * Replace window.createQuickPick with a recorder; returns the list of
 * created FakeQuickPicks (most tests use created[0]).
 */
export function installFakeQuickPick(): FakeQuickPick<vscode.QuickPickItem>[] {
    const created: FakeQuickPick<vscode.QuickPickItem>[] = [];
    (vscode.window as unknown as { createQuickPick: () => unknown }).createQuickPick = () => {
        const qp = new FakeQuickPick<vscode.QuickPickItem>();
        created.push(qp);
        return qp;
    };
    return created;
}
