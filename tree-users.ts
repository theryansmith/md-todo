import * as vscode from 'vscode';
import { TodoItem, UserDefinition, ParsedDocument, TreeNode } from './types';
import { isTodoFile, parseDocument, classifyItemSection } from './parser';
import { setFocusUserState } from './state';
import { updateDimDecorations } from './decoration-dim';
import { refreshFocusStatusBar } from './focus-user';
import { markDone } from './commands-mark-done';

export class MdTodoUsersTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private workspaceState: vscode.Memento) {
        const lastUri = workspaceState.get<string>('mdTodo.users.lastTodoFileUri');
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
            this.workspaceState.update('mdTodo.users.lastTodoFileUri', uri.toString());
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

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'user') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                node.user.fullname,
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `@${node.user.shortname}  (${node.counts.active} active)`;
            item.tooltip = `${node.user.fullname} — ${node.user.description}\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'user';
            item.iconPath = new vscode.ThemeIcon('person');
            return item;
        }

        if (node.kind === 'unassigned') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                'Unassigned',
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `Todos with no @mention\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'unassigned';
            item.iconPath = new vscode.ThemeIcon('person-add');
            return item;
        }

        if (node.kind === 'section') {
            const labels = { active: 'Active', completed: 'Completed', archive: 'Archive' };
            const item = new vscode.TreeItem(
                `${labels[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'section';
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
        item.contextValue = 'todo';
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

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) {
            return [];
        }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            const userNodes: TreeNode[] = [];
            for (const user of parsed.userDefinitions) {
                const counts = this.countItemsForMention(parsed, user.shortname);
                userNodes.push({ kind: 'user', user, counts, sourceUri });
            }
            userNodes.sort((a, b) =>
                a.kind === 'user' && b.kind === 'user'
                    ? a.user.shortname.localeCompare(b.user.shortname, undefined, {
                          sensitivity: 'base',
                      })
                    : 0
            );

            const unassignedCounts = this.countUnassigned(parsed);
            userNodes.push({ kind: 'unassigned', counts: unassignedCounts, sourceUri });

            return userNodes;
        }

        if (element.kind === 'user') {
            return this.buildSectionNodes(parsed, element.user, sourceUri);
        }

        if (element.kind === 'unassigned') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'section') {
            return element.items.map((item) => ({ kind: 'todo' as const, item, sourceUri }));
        }

        return [];
    }

    private buildSectionNodes(
        parsed: ParsedDocument,
        user: UserDefinition | null,
        sourceUri: vscode.Uri
    ): TreeNode[] {
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
            if (user) {
                if (it.mentions.includes(user.shortname)) {
                    buckets[sect].push(it);
                }
            } else {
                if (it.mentions.length === 0) {
                    buckets[sect].push(it);
                }
            }
        });

        const result: TreeNode[] = [];
        for (const sect of ['active', 'completed', 'archive'] as const) {
            if (buckets[sect].length > 0) {
                result.push({
                    kind: 'section',
                    user,
                    section: sect,
                    items: buckets[sect],
                    sourceUri,
                });
            }
        }
        return result;
    }

    private countItemsForMention(
        parsed: ParsedDocument,
        shortname: string
    ): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (!it.mentions.includes(shortname)) {
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

    private countUnassigned(parsed: ParsedDocument): {
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
            if (it.mentions.length !== 0) {
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

export async function focusOnUserFromTree(node?: TreeNode) {
    if (node?.kind !== 'user') {
        vscode.window.showWarningMessage('Right-click a user in the MD Todo Users view.');
        return;
    }
    await setFocusUserState(node.user.shortname);
    refreshFocusStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        updateDimDecorations(visible);
    }
}

export async function clearUserFocusFromTree() {
    await setFocusUserState(undefined);
    refreshFocusStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
}

export async function reassignUserFromTree(treeProvider: MdTodoUsersTreeProvider, node?: TreeNode) {
    if (node?.kind !== 'todo') {
        return;
    }

    const uri = treeProvider.getCurrentUri();
    if (!uri) {
        return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const parsed = parseDocument(doc);

    if (parsed.userDefinitions.length === 0) {
        vscode.window.showInformationMessage('No users defined. Add a ## Users section first.');
        return;
    }

    const picks = parsed.userDefinitions.map((u) => ({
        label: `@${u.shortname}`,
        description: u.fullname,
        detail: u.description,
        user: u,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: `Reassign: ${node.item.text}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected) {
        return;
    }

    // Design choice: if the line already has any @mention, replace the FIRST mention.
    // If none, append the @mention to the end of the line (before any trailing whitespace).
    const editor = await vscode.window.showTextDocument(doc);
    const line = doc.lineAt(node.item.line);
    let newText = line.text;
    const mentionRe = /@[\w-]+/;

    if (mentionRe.test(newText)) {
        newText = newText.replace(mentionRe, `@${selected.user.shortname}`);
    } else {
        newText = newText.replace(/\s*$/, '') + ` @${selected.user.shortname}`;
    }

    await editor.edit((eb) => {
        eb.replace(line.range, newText);
    });
    treeProvider.refresh();
}

export async function markDoneFromTree(treeProvider: MdTodoUsersTreeProvider, node?: TreeNode) {
    if (node?.kind !== 'todo') {
        return;
    }
    if (node.item.isComplete) {
        vscode.window.showInformationMessage('Item is already complete');
        return;
    }
    const uri = treeProvider.getCurrentUri();
    if (!uri) {
        return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await markDone(editor, undefined, node.item.line);
    treeProvider.refresh();
}
