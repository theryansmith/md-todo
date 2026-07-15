import * as vscode from 'vscode';
import { ParsedDocument } from '../core/model';
import { isTodoFile, parseDocument } from './document-cache';
import { requireTodoEditor } from './guards';
import { StateKey, getWorkspaceState, updateWorkspaceState } from './workspace-state';

/**
 * One focus engine, four instances (F-04). A focus dimension is: a
 * workspaceState key, a right-aligned status-bar item, an optional
 * "pick then set" command over the parsed definitions, an optional dedicated
 * clear command, and an on-change side effect (the dim repaint, supplied by
 * the feature layer so this module never imports features/). Everything the
 * four hand-cloned focus modules duplicated lives here; the per-dimension
 * differences are the descriptor fields, catalogued as Appendix B of the TDD
 * (Docs/tdd/enterprise-restructure.md).
 */

/** A QuickPick row carrying the focus value it selects. */
export interface FocusPickEntry<T> extends vscode.QuickPickItem {
    value: T;
}

/**
 * The "pick then set" command surface. Present for user/tag/project; absent
 * for activity, whose status-bar click opens a command menu instead and
 * whose focus values are written by the report commands (Appendix B row B9).
 */
export interface FocusPickDescriptor<T> {
    /** Command ID registered to run pickAndSet() — frozen in package.json. */
    commandId: string;
    /** Description of the leading `$(circle-slash) Clear focus` entry. */
    clearDescription: string;
    /** Info toast when the document defines nothing to pick (row B10). */
    noDefinitionsMessage: string;
    /** Placeholder when no focus is set (row B11). */
    selectPlaceholder: string;
    /** Placeholder when a focus is set, formatted in the dimension's token. */
    currentPlaceholder(current: T): string;
    /** Sorted, formatted definition entries (rows B4/B9/B16-analogue). */
    entries(parsed: ParsedDocument): FocusPickEntry<T>[];
}

export interface FocusDimensionDescriptor<T> {
    id: 'user' | 'tag' | 'project' | 'activity';
    /** Typed workspaceState key the focus value persists under (row B1). */
    stateKey: StateKey<T>;
    statusBar: {
        /**
         * Right-alignment priority (row B2). All four items are Right-aligned,
         * so on-screen left-to-right order is DESCENDING priority:
         * user (100), tag (99), activity (98), project (97) — frozen.
         */
        priority: number;
        /** Command the status-bar item runs when clicked (row B3). */
        command: string;
        unsetText: string;
        unsetTooltip: string;
        setText(value: T): string;
        /**
         * Tooltip for the set state. Receives the active todo document so the
         * user dimension can resolve `@shortname` to the fullname (row B8).
         */
        setTooltip(value: T, document: vscode.TextDocument): string;
    };
    /** Definitions QuickPick — omit for menu-driven dimensions (activity). */
    pick?: FocusPickDescriptor<T>;
    /** Dedicated clear command ID, when one exists (activity, row B13). */
    clearCommandId?: string;
    /**
     * Side effect after every set()/clear(): repaint dim in the visible todo
     * editors. Injected by the feature layer (decoration-dim) — the vscode/
     * layer may not import features/ under the layering zones.
     */
    onDidChange(): void;
}

/**
 * The T-free surface the registry, activation wiring, and editor events use.
 * FocusDimension<T> satisfies it structurally for every T.
 */
export interface RegisteredFocusDimension {
    register(context: vscode.ExtensionContext): void;
    refreshStatusBar(editor: vscode.TextEditor | undefined): void;
    clear(): Promise<void>;
    /**
     * Every command ID register() registers for this dimension (the pick
     * command and/or the dedicated clear command). Consumed by the
     * package.json ↔ registration consistency test.
     */
    readonly commandIds: readonly string[];
}

export class FocusDimension<T> implements RegisteredFocusDimension {
    private statusBarItem: vscode.StatusBarItem | undefined;

    constructor(private readonly descriptor: FocusDimensionDescriptor<T>) {}

    /**
     * Create the status-bar item (into context.subscriptions) and register
     * the dimension's commands. Called once per dimension from activate().
     */
    register(context: vscode.ExtensionContext): void {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            this.descriptor.statusBar.priority
        );
        this.statusBarItem.command = this.descriptor.statusBar.command;
        context.subscriptions.push(this.statusBarItem);

        const pick = this.descriptor.pick;
        if (pick) {
            context.subscriptions.push(
                vscode.commands.registerCommand(pick.commandId, () => this.pickAndSet())
            );
        }
        if (this.descriptor.clearCommandId) {
            context.subscriptions.push(
                vscode.commands.registerCommand(this.descriptor.clearCommandId, () => this.clear())
            );
        }
    }

    /** The command IDs register() registers — mirrors its two branches. */
    get commandIds(): readonly string[] {
        const ids: string[] = [];
        if (this.descriptor.pick) {
            ids.push(this.descriptor.pick.commandId);
        }
        if (this.descriptor.clearCommandId) {
            ids.push(this.descriptor.clearCommandId);
        }
        return ids;
    }

    /** The current focus value, or undefined when unfocused. */
    get(): T | undefined {
        return getWorkspaceState(this.descriptor.stateKey);
    }

    /**
     * Raw state write with NO side effects. The tree context-menu handlers
     * use this because their repaint scope differs (features/tree-commands.ts
     * repaints ALL visible editors on a tree-driven set); command paths use
     * set()/clear() below.
     */
    async setState(value: T | undefined): Promise<void> {
        await updateWorkspaceState(this.descriptor.stateKey, value);
    }

    /**
     * Set the focus with the audited side-effect order (Appendix B): state
     * write → dim repaint in visible todo editors → own status-bar refresh.
     */
    async set(value: T | undefined): Promise<void> {
        await this.setState(value);
        this.descriptor.onDidChange();
        this.refreshStatusBar(vscode.window.activeTextEditor);
    }

    clear(): Promise<void> {
        return this.set(undefined);
    }

    /** Hide on non-todo editors; otherwise show the unset or set text. */
    refreshStatusBar(editor: vscode.TextEditor | undefined): void {
        if (!this.statusBarItem) {
            return;
        }
        if (!editor || !isTodoFile(editor.document)) {
            this.statusBarItem.hide();
            return;
        }
        const focus = this.get();
        if (!focus) {
            this.statusBarItem.text = this.descriptor.statusBar.unsetText;
            this.statusBarItem.tooltip = this.descriptor.statusBar.unsetTooltip;
        } else {
            this.statusBarItem.text = this.descriptor.statusBar.setText(focus);
            this.statusBarItem.tooltip = this.descriptor.statusBar.setTooltip(
                focus,
                editor.document
            );
        }
        this.statusBarItem.show();
    }

    /**
     * The pick-and-set command: 'Open a todo file first' pre-guard (a
     * deliberately distinct message — NOT the canonical requireTodoEditor
     * warning, see Phase 3a notes), then the canonical guard, then a
     * QuickPick of Clear-entry + sorted definitions. Esc → no side effects.
     */
    async pickAndSet(): Promise<void> {
        const pick = this.descriptor.pick;
        if (!pick) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a todo file first');
            return;
        }
        const ctx = requireTodoEditor(editor);
        if (!ctx) {
            return;
        }
        const parsed = parseDocument(ctx.document);

        const entries = pick.entries(parsed);
        type Pick = vscode.QuickPickItem & { value: T | undefined };
        const picks: Pick[] = [
            {
                label: '$(circle-slash) Clear focus',
                description: pick.clearDescription,
                value: undefined,
            },
            ...entries,
        ];

        if (entries.length === 0) {
            vscode.window.showInformationMessage(pick.noDefinitionsMessage);
        }

        const current = this.get();
        const placeHolder = current ? pick.currentPlaceholder(current) : pick.selectPlaceholder;

        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) {
            return;
        }

        await this.set(picked.value);
    }
}
