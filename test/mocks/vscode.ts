/**
 * Minimal inert stub of the 'vscode' host API, aliased in vitest.config.ts.
 * Only covers what the production modules under test touch at runtime —
 * mostly class constructors used in type positions or object literals.
 * Nothing here performs real editor work.
 */

export class Position {
    constructor(
        public readonly line: number,
        public readonly character: number
    ) {}
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;
    constructor(
        startLine: number | Position,
        startChar: number | Position,
        endLine?: number,
        endChar?: number
    ) {
        if (typeof startLine === 'number') {
            this.start = new Position(startLine, startChar as number);
            this.end = new Position(endLine!, endChar!);
        } else {
            this.start = startLine;
            this.end = startChar as Position;
        }
    }
}

export class Selection extends Range {}

export class ThemeIcon {
    constructor(public readonly id: string) {}
}

export class ThemeColor {
    constructor(public readonly id: string) {}
}

export class MarkdownString {
    value = '';
    appendMarkdown(text: string): this {
        this.value += text;
        return this;
    }
}

export class EventEmitter<T> {
    private listeners: ((e: T) => unknown)[] = [];
    event = (listener: (e: T) => unknown) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
    };
    fire(data?: T): void {
        for (const l of this.listeners) {
            l(data as T);
        }
    }
    dispose(): void {
        this.listeners = [];
    }
}

export class TreeItem {
    description?: string;
    tooltip?: string;
    contextValue?: string;
    iconPath?: ThemeIcon;
    command?: unknown;
    constructor(
        public label: string,
        public collapsibleState?: number
    ) {}
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export enum ViewColumn {
    Beside = -2,
    Active = -1,
    One = 1,
    Two = 2,
}

export class CompletionItem {
    detail?: string;
    documentation?: MarkdownString;
    insertText?: string;
    range?: Range;
    filterText?: string;
    sortText?: string;
    constructor(
        public label: string,
        public kind?: number
    ) {}
}

export enum CompletionItemKind {
    Keyword = 13,
    Module = 8,
    User = 25,
}

export enum QuickPickItemKind {
    Separator = -1,
    Default = 0,
}

export class Hover {
    constructor(
        public contents: unknown,
        public range?: Range
    ) {}
}

export const Uri = {
    parse(value: string): { toString(): string } {
        return { toString: () => value };
    },
    file(path: string): { toString(): string } {
        return { toString: () => `file://${path}` };
    },
};

/** One recorded WorkspaceEdit operation, in call order. */
export type RecordedWorkspaceEditOp =
    | { kind: 'replace'; uri: unknown; range: Range; newText: string }
    | { kind: 'delete'; uri: unknown; range: Range }
    | { kind: 'insert'; uri: unknown; position: Position; newText: string };

/**
 * Records its operations so tests can assert exactly what the edit-executor
 * put into ONE atomic edit. Applied edits are collected on
 * `workspace.appliedEdits` by the `workspace.applyEdit` stub.
 */
export class WorkspaceEdit {
    readonly ops: RecordedWorkspaceEditOp[] = [];
    replace(uri: unknown, range: Range, newText: string): void {
        this.ops.push({ kind: 'replace', uri, range, newText });
    }
    delete(uri: unknown, range: Range): void {
        this.ops.push({ kind: 'delete', uri, range });
    }
    insert(uri: unknown, position: Position, newText: string): void {
        this.ops.push({ kind: 'insert', uri, position, newText });
    }
}

const inertDisposable = { dispose: () => undefined };

export const window = {
    activeTextEditor: undefined as unknown,
    visibleTextEditors: [] as unknown[],
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showQuickPick: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    createTextEditorDecorationType: () => inertDisposable,
    // Records alignment/priority and tracks show()/hide() via `visible` so
    // status-bar characterization tests can pin text/tooltip/visibility.
    createStatusBarItem: (alignment?: number, priority?: number) => ({
        alignment,
        priority,
        text: '',
        tooltip: '',
        command: '',
        visible: false,
        show(): void {
            this.visible = true;
        },
        hide(): void {
            this.visible = false;
        },
        dispose: () => undefined,
    }),
    createTreeView: () => inertDisposable,
    showTextDocument: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: () => inertDisposable,
};

export const workspace = {
    getConfiguration: () => ({ get: <T>(_key: string, defaultValue?: T) => defaultValue }),
    openTextDocument: () => Promise.reject(new Error('vscode-mock: no documents')),
    onDidChangeTextDocument: () => inertDisposable,
    onDidSaveTextDocument: () => inertDisposable,
    onDidCloseTextDocument: () => inertDisposable,
    /** Every WorkspaceEdit passed to applyEdit, in order. Reset per test. */
    appliedEdits: [] as WorkspaceEdit[],
    applyEdit(edit: WorkspaceEdit): Promise<boolean> {
        workspace.appliedEdits.push(edit);
        return Promise.resolve(true);
    },
};

export const commands = {
    registerCommand: () => inertDisposable,
    registerTextEditorCommand: () => inertDisposable,
    executeCommand: () => Promise.resolve(undefined),
};

export const languages = {
    registerCompletionItemProvider: () => inertDisposable,
    registerHoverProvider: () => inertDisposable,
};
