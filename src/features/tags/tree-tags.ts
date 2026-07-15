import * as vscode from 'vscode';
import { TodoItem, TagDefinition, ParsedDocument, TagsTreeNode } from '../../core/types';
import { isTodoFile, parseDocument, classifyItemSection } from '../../core/parser';
import { setFocusTagState } from '../../vscode/state';
import { updateDimDecorations } from '../focus/decoration-dim';
import { refreshFocusTagStatusBar } from '../focus/focus-tag';
import { markDone } from '../items/commands-mark-done';

export class MdTodoTagsTreeProvider implements vscode.TreeDataProvider<TagsTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TagsTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private workspaceState: vscode.Memento) {
        const lastUri = workspaceState.get<string>('mdTodo.tags.lastTodoFileUri');
        if (lastUri) {
            try {
                this.currentUri = vscode.Uri.parse(lastUri);
            } catch {
                this.currentUri = undefined;
            }
        }
    }

    setCurrentTodoFile(uri: vscode.Uri | undefined) {
        if (uri && uri.toString() === this.currentUri?.toString()) {
            return;
        }
        this.currentUri = uri;
        if (uri) {
            this.workspaceState.update('mdTodo.tags.lastTodoFileUri', uri.toString());
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getCurrentUri(): vscode.Uri | undefined {
        return this.currentUri;
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    refreshDebounced() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this._onDidChangeTreeData.fire(undefined);
            this.refreshTimer = undefined;
        }, 200);
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

    getTreeItem(node: TagsTreeNode): vscode.TreeItem {
        if (node.kind === 'tag-root') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                `#${node.tag.name}`,
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `#${node.tag.name} — ${node.tag.description}\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'tag-root';
            item.iconPath = new vscode.ThemeIcon('tag');
            return item;
        }

        if (node.kind === 'untagged') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                'Untagged',
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `Todos with no #tag\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'untagged';
            item.iconPath = new vscode.ThemeIcon('circle-slash');
            return item;
        }

        if (node.kind === 'tag-section') {
            const labels = { active: 'Active', completed: 'Completed', archive: 'Archive' };
            const item = new vscode.TreeItem(
                `${labels[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'tag-section';
            const iconName =
                node.section === 'active'
                    ? 'list-unordered'
                    : node.section === 'completed'
                      ? 'check-all'
                      : 'archive';
            item.iconPath = new vscode.ThemeIcon(iconName);
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
        item.contextValue = 'tag-todo';
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

    async getChildren(element?: TagsTreeNode): Promise<TagsTreeNode[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) {
            return [];
        }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            const roots: TagsTreeNode[] = [];
            for (const tag of parsed.tagDefinitions) {
                const counts = this.countItemsForTag(parsed, tag.name);
                roots.push({ kind: 'tag-root', tag, counts, sourceUri });
            }
            roots.sort((a, b) =>
                a.kind === 'tag-root' && b.kind === 'tag-root'
                    ? a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: 'base' })
                    : 0
            );
            const untaggedCounts = this.countUntagged(parsed);
            roots.push({ kind: 'untagged', counts: untaggedCounts, sourceUri });
            return roots;
        }

        if (element.kind === 'tag-root') {
            return this.buildSectionNodes(parsed, element.tag, sourceUri);
        }

        if (element.kind === 'untagged') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'tag-section') {
            return element.items.map((item) => ({ kind: 'tag-todo' as const, item, sourceUri }));
        }

        return [];
    }

    private buildSectionNodes(
        parsed: ParsedDocument,
        tag: TagDefinition | null,
        sourceUri: vscode.Uri
    ): TagsTreeNode[] {
        const buckets: Record<'active' | 'completed' | 'archive', TodoItem[]> = {
            active: [],
            completed: [],
            archive: [],
        };

        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }

        visitAll(parsed.items, (it) => {
            const sect = classifyItemSection(it, parsed);
            if (!sect) {
                return;
            }
            if (tag) {
                if (it.tags.includes(tag.name)) {
                    buckets[sect].push(it);
                }
            } else {
                if (it.tags.length === 0) {
                    buckets[sect].push(it);
                }
            }
        });

        const result: TagsTreeNode[] = [];
        for (const sect of ['active', 'completed', 'archive'] as const) {
            if (buckets[sect].length > 0) {
                result.push({
                    kind: 'tag-section',
                    tag,
                    section: sect,
                    items: buckets[sect],
                    sourceUri,
                });
            }
        }
        return result;
    }

    private countItemsForTag(
        parsed: ParsedDocument,
        tagName: string
    ): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (!it.tags.includes(tagName)) {
                return;
            }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') {
                counts.active++;
            } else if (sect === 'completed') {
                counts.completed++;
            } else if (sect === 'archive') {
                counts.archived++;
            }
        });
        return counts;
    }

    private countUntagged(parsed: ParsedDocument): {
        active: number;
        completed: number;
        archived: number;
    } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (it.tags.length !== 0) {
                return;
            }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') {
                counts.active++;
            } else if (sect === 'completed') {
                counts.completed++;
            } else if (sect === 'archive') {
                counts.archived++;
            }
        });
        return counts;
    }
}

export async function focusOnTagFromTree(node?: TagsTreeNode) {
    if (node?.kind !== 'tag-root') {
        vscode.window.showWarningMessage('Right-click a tag in the MD Todo Tags view.');
        return;
    }
    await setFocusTagState(node.tag.name);
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        updateDimDecorations(visible);
    }
}

export async function clearTagFocusFromTree() {
    await setFocusTagState(undefined);
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
}

export async function markDoneFromTagsTree(
    treeProvider: MdTodoTagsTreeProvider,
    node?: TagsTreeNode
) {
    if (node?.kind !== 'tag-todo') {
        return;
    }
    if (node.item.isComplete) {
        vscode.window.showInformationMessage('Item is already complete');
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await markDone(editor, undefined, node.item.line);
    treeProvider.refresh();
}

export async function editTagsFromTree(node?: TagsTreeNode) {
    if (node?.kind !== 'tag-todo') {
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Place cursor on the target line so addTags' findItemAtCursor picks it up.
    const pos = new vscode.Position(node.item.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await vscode.commands.executeCommand('mdTodo.addTags');
}
