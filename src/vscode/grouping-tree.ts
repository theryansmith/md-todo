import * as vscode from 'vscode';
import { TodoItem, ParsedDocument } from '../core/model';
import { classifyItemSection } from '../core/parse/sections';
import { isTodoFile, parseDocument } from './document-cache';

/**
 * One keyed-grouping tree, three instances (F-02). A GroupingDescriptor
 * describes WHICH groups a document defines and WHERE an item belongs; the
 * GroupingTreeProvider owns everything the three hand-cloned providers used
 * to duplicate: current-URI tracking with workspaceState persistence,
 * immediate + debounced refresh (the debounce timer is cancelled on dispose —
 * the provider is a vscode.Disposable pushed to context.subscriptions),
 * document loading through the memoized parse cache, recursive counting,
 * section bucketing via classifyItemSection, and TreeItem construction.
 *
 * Every intentional behavioral divergence between the Users/Tags/Projects
 * trees is a descriptor field; the audit that produced this parameter list
 * is Appendix A of Docs/tdd/enterprise-restructure.md.
 */
export interface GroupingDescriptor<TDef> {
    readonly id: 'users' | 'tags' | 'projects';
    /** Groups defined in the document (`## Users` / `## Tags` / `## Projects`). */
    readonly definitionsOf: (parsed: ParsedDocument) => TDef[];
    /**
     * Synthetic groups appended AFTER the sorted defined roots (Projects:
     * names used on items but missing from `## Projects`). Optional.
     */
    readonly syntheticDefinitionsOf?: (parsed: ParsedDocument) => TDef[];
    /**
     * Group keys an item belongs to. Users: its @mentions; Tags: its #tags;
     * Projects: the singleton effective (inherited) project, or []. An item
     * with no keys lands in the unassigned bucket.
     */
    readonly keysOf: (item: TodoItem) => string[];
    /** The group key of a definition — also the case-insensitive root sort key. */
    readonly keyOf: (def: TDef) => string;
    /** Root node label (Users: fullname; Tags: `#name`; Projects: name). */
    readonly labelOf: (def: TDef) => string;
    /** Root node description; default `(<n> active)` (Users prepends `@shortname`). */
    readonly rootDescriptionOf?: (def: TDef, counts: GroupCounts) => string;
    /** First tooltip line; the engine appends the Active/Completed/Archive counts. */
    readonly rootTooltipHeaderOf: (def: TDef) => string;
    /** ThemeIcon id for a root (Projects: `warning` for synthetic roots). */
    readonly rootIconOf: (def: TDef) => string;
    readonly unassignedLabel: string;
    readonly unassignedIcon: string;
    /** First tooltip line of the unassigned bucket, e.g. `Todos with no @mention`. */
    readonly unassignedTooltipHeader: string;
    /**
     * TreeItem contextValues, frozen — package.json contributes.menus
     * references them in `viewItem ==` clauses.
     */
    readonly contextValues: {
        root: string;
        unassigned: string;
        section: string;
        todo: string;
    };
}

export interface GroupCounts {
    active: number;
    completed: number;
    archived: number;
}

export type GroupSection = 'active' | 'completed' | 'archive';

export interface GroupRootNode<TDef> {
    kind: 'root';
    def: TDef;
    counts: GroupCounts;
    sourceUri: vscode.Uri;
}

export interface GroupUnassignedNode {
    kind: 'unassigned';
    counts: GroupCounts;
    sourceUri: vscode.Uri;
}

export interface GroupSectionNode {
    kind: 'section';
    /** Group key this section belongs to; null = the unassigned bucket. */
    key: string | null;
    section: GroupSection;
    items: TodoItem[];
    sourceUri: vscode.Uri;
}

export interface GroupTodoNode {
    kind: 'todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
}

export type GroupingTreeNode<TDef> =
    GroupRootNode<TDef> | GroupUnassignedNode | GroupSectionNode | GroupTodoNode;

const SECTION_ORDER: readonly GroupSection[] = ['active', 'completed', 'archive'];
const SECTION_LABELS: Record<GroupSection, string> = {
    active: 'Active',
    completed: 'Completed',
    archive: 'Archive',
};
const SECTION_ICONS: Record<GroupSection, string> = {
    active: 'list-unordered',
    completed: 'check-all',
    archive: 'archive',
};

/** Visit an item and all its descendants, depth-first, in document order. */
function visitAll(items: TodoItem[], cb: (item: TodoItem) => void): void {
    for (const item of items) {
        cb(item);
        visitAll(item.children, cb);
    }
}

export class GroupingTreeProvider<TDef>
    implements vscode.TreeDataProvider<GroupingTreeNode<TDef>>, vscode.Disposable
{
    private _onDidChangeTreeData = new vscode.EventEmitter<GroupingTreeNode<TDef> | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly lastUriStateKey: string;
    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly descriptor: GroupingDescriptor<TDef>,
        private readonly workspaceState: vscode.Memento
    ) {
        this.lastUriStateKey = `mdTodo.${descriptor.id}.lastTodoFileUri`;
        const lastUri = workspaceState.get<string>(this.lastUriStateKey);
        if (lastUri) {
            try {
                this.currentUri = vscode.Uri.parse(lastUri);
            } catch {
                this.currentUri = undefined;
            }
        }
    }

    setCurrentTodoFile(uri: vscode.Uri | undefined): void {
        if (uri && uri.toString() === this.currentUri?.toString()) {
            return;
        }
        this.currentUri = uri;
        if (uri) {
            this.workspaceState.update(this.lastUriStateKey, uri.toString());
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getCurrentUri(): vscode.Uri | undefined {
        return this.currentUri;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    refreshDebounced(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this._onDidChangeTreeData.fire(undefined);
            this.refreshTimer = undefined;
        }, 200);
    }

    /**
     * Cancel any pending debounced refresh and release the change emitter.
     * Registered in context.subscriptions so deactivation never leaves a live
     * timer behind (the pre-3c providers leaked theirs).
     */
    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this._onDidChangeTreeData.dispose();
    }

    private async getCurrentParsed(): Promise<{
        doc: vscode.TextDocument;
        parsed: ParsedDocument;
    } | null> {
        if (!this.currentUri) {
            return null;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(this.currentUri);
            if (!isTodoFile(doc)) {
                return null;
            }
            return { doc, parsed: parseDocument(doc) };
        } catch {
            return null;
        }
    }

    getTreeItem(node: GroupingTreeNode<TDef>): vscode.TreeItem {
        const cv = this.descriptor.contextValues;

        if (node.kind === 'root') {
            return this.buildGroupItem(
                this.descriptor.labelOf(node.def),
                this.descriptor.rootDescriptionOf?.(node.def, node.counts) ??
                    `(${node.counts.active} active)`,
                this.descriptor.rootTooltipHeaderOf(node.def),
                this.descriptor.rootIconOf(node.def),
                cv.root,
                node.counts
            );
        }

        if (node.kind === 'unassigned') {
            return this.buildGroupItem(
                this.descriptor.unassignedLabel,
                `(${node.counts.active} active)`,
                this.descriptor.unassignedTooltipHeader,
                this.descriptor.unassignedIcon,
                cv.unassigned,
                node.counts
            );
        }

        if (node.kind === 'section') {
            const item = new vscode.TreeItem(
                `${SECTION_LABELS[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = cv.section;
            item.iconPath = new vscode.ThemeIcon(SECTION_ICONS[node.section]);
            return item;
        }

        const todo = node.item;
        const item = new vscode.TreeItem(
            todo.text || '(untitled)',
            vscode.TreeItemCollapsibleState.None
        );
        item.description = todo.isComplete
            ? todo.completedDate
                ? `done ${todo.completedDate}`
                : 'done'
            : todo.addedDate
              ? `added ${todo.addedDate}`
              : '';
        item.tooltip = todo.raw;
        item.contextValue = cv.todo;
        item.iconPath = new vscode.ThemeIcon(todo.isComplete ? 'check' : 'circle-outline');
        item.command = {
            command: 'vscode.open',
            title: 'Open Todo',
            arguments: [
                node.sourceUri,
                {
                    selection: new vscode.Range(todo.line, 0, todo.line, 0),
                    preview: false,
                },
            ],
        };
        return item;
    }

    private buildGroupItem(
        label: string,
        description: string,
        tooltipHeader: string,
        icon: string,
        contextValue: string,
        counts: GroupCounts
    ): vscode.TreeItem {
        const total = counts.active + counts.completed + counts.archived;
        const item = new vscode.TreeItem(
            label,
            total > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        item.description = description;
        item.tooltip = `${tooltipHeader}\nActive: ${counts.active}  Completed: ${counts.completed}  Archive: ${counts.archived}`;
        item.contextValue = contextValue;
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
    }

    async getChildren(element?: GroupingTreeNode<TDef>): Promise<GroupingTreeNode<TDef>[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) {
            return [];
        }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            const roots: GroupingTreeNode<TDef>[] = [];
            const defined = [...this.descriptor.definitionsOf(parsed)].sort((a, b) =>
                this.descriptor
                    .keyOf(a)
                    .localeCompare(this.descriptor.keyOf(b), undefined, { sensitivity: 'base' })
            );
            for (const def of defined) {
                roots.push({
                    kind: 'root',
                    def,
                    counts: this.countGroup(parsed, this.descriptor.keyOf(def)),
                    sourceUri,
                });
            }
            // Synthetic roots (already sorted by the descriptor) go after the
            // defined ones so e.g. an undefined project name never interleaves
            // with the `## Projects` entries.
            for (const def of this.descriptor.syntheticDefinitionsOf?.(parsed) ?? []) {
                roots.push({
                    kind: 'root',
                    def,
                    counts: this.countGroup(parsed, this.descriptor.keyOf(def)),
                    sourceUri,
                });
            }
            roots.push({ kind: 'unassigned', counts: this.countGroup(parsed, null), sourceUri });
            return roots;
        }

        if (element.kind === 'root') {
            return this.buildSectionNodes(parsed, this.descriptor.keyOf(element.def), sourceUri);
        }

        if (element.kind === 'unassigned') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'section') {
            return element.items.map((item) => ({ kind: 'todo' as const, item, sourceUri }));
        }

        return [];
    }

    /** Does the item belong to the group (null = the unassigned bucket)? */
    private belongs(item: TodoItem, key: string | null): boolean {
        const keys = this.descriptor.keysOf(item);
        return key === null ? keys.length === 0 : keys.includes(key);
    }

    private countGroup(parsed: ParsedDocument, key: string | null): GroupCounts {
        const counts: GroupCounts = { active: 0, completed: 0, archived: 0 };
        visitAll(parsed.items, (item) => {
            if (!this.belongs(item, key)) {
                return;
            }
            const section = classifyItemSection(item, parsed);
            if (section === 'active') {
                counts.active++;
            } else if (section === 'completed') {
                counts.completed++;
            } else if (section === 'archive') {
                counts.archived++;
            }
        });
        return counts;
    }

    private buildSectionNodes(
        parsed: ParsedDocument,
        key: string | null,
        sourceUri: vscode.Uri
    ): GroupingTreeNode<TDef>[] {
        const buckets: Record<GroupSection, TodoItem[]> = {
            active: [],
            completed: [],
            archive: [],
        };
        visitAll(parsed.items, (item) => {
            const section = classifyItemSection(item, parsed);
            if (section && this.belongs(item, key)) {
                buckets[section].push(item);
            }
        });

        const result: GroupingTreeNode<TDef>[] = [];
        for (const section of SECTION_ORDER) {
            if (buckets[section].length > 0) {
                result.push({ kind: 'section', key, section, items: buckets[section], sourceUri });
            }
        }
        return result;
    }
}
