import * as vscode from 'vscode';
import { TodoItem, ProjectDefinition, ParsedDocument, ProjectsTreeNode } from '../../core/types';
import {
    isTodoFile,
    parseDocument,
    classifyItemSection,
    getEffectiveProject,
    isDefinedProject,
} from '../../core/parser';
import { setFocusProjectState } from '../../vscode/state';
import { updateDimDecorations } from '../focus/decoration-dim';
import { refreshFocusProjectStatusBar } from '../focus/focus-project';
import { markDone } from '../items/commands-mark-done';
import { showProjectViewForProject } from './project-view';

/**
 * Project names that are used on items (own token or inherited) but have no
 * entry in `## Projects`. These get synthetic roots in the tree so the tasks
 * carrying them are still reachable. Sorted with the same case-insensitive
 * comparator as defined projects. Pure — exported for unit tests.
 */
export function collectUndefinedProjectNames(parsed: ParsedDocument): string[] {
    const used = new Set<string>();
    function visitAll(items: TodoItem[]) {
        for (const it of items) {
            const name = getEffectiveProject(it);
            if (name && !isDefinedProject(name, parsed.projectDefinitions)) {
                used.add(name);
            }
            visitAll(it.children);
        }
    }
    visitAll(parsed.items);
    return [...used].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export class MdTodoProjectsTreeProvider implements vscode.TreeDataProvider<ProjectsTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectsTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private workspaceState: vscode.Memento) {
        const lastUri = workspaceState.get<string>('mdTodo.projects.lastTodoFileUri');
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
            this.workspaceState.update('mdTodo.projects.lastTodoFileUri', uri.toString());
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

    getTreeItem(node: ProjectsTreeNode): vscode.TreeItem {
        if (node.kind === 'project-root') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                node.project.name,
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `[${node.project.name}] — ${node.project.description}\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'project-root';
            // line === -1 marks a synthetic root for a used-but-undefined
            // project name (see collectUndefinedProjectNames).
            item.iconPath = new vscode.ThemeIcon(node.project.line === -1 ? 'warning' : 'project');
            return item;
        }

        if (node.kind === 'no-project') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                'No Project',
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `Todos with no [project]\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'no-project';
            item.iconPath = new vscode.ThemeIcon('circle-slash');
            return item;
        }

        if (node.kind === 'project-section') {
            const labels = { active: 'Active', completed: 'Completed', archive: 'Archive' };
            const item = new vscode.TreeItem(
                `${labels[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'project-section';
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
        item.contextValue = 'project-todo';
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

    async getChildren(element?: ProjectsTreeNode): Promise<ProjectsTreeNode[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) {
            return [];
        }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            const roots: ProjectsTreeNode[] = [];
            for (const project of parsed.projectDefinitions) {
                const counts = this.countItemsForProject(parsed, project.name);
                roots.push({ kind: 'project-root', project, counts, sourceUri });
            }
            roots.sort((a, b) =>
                a.kind === 'project-root' && b.kind === 'project-root'
                    ? a.project.name.localeCompare(b.project.name, undefined, {
                          sensitivity: 'base',
                      })
                    : 0
            );
            // Synthetic roots for project names used on items but missing
            // from ## Projects — appended after the defined roots (already
            // sorted by collectUndefinedProjectNames) so the tasks carrying
            // them stay reachable. Marked in getTreeItem via line === -1.
            for (const name of collectUndefinedProjectNames(parsed)) {
                const counts = this.countItemsForProject(parsed, name);
                roots.push({
                    kind: 'project-root',
                    project: { name, description: 'Not defined in ## Projects', line: -1 },
                    counts,
                    sourceUri,
                });
            }
            const noProjectCounts = this.countNoProject(parsed);
            roots.push({ kind: 'no-project', counts: noProjectCounts, sourceUri });
            return roots;
        }

        if (element.kind === 'project-root') {
            return this.buildSectionNodes(parsed, element.project, sourceUri);
        }

        if (element.kind === 'no-project') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'project-section') {
            return element.items.map((item) => ({
                kind: 'project-todo' as const,
                item,
                sourceUri,
            }));
        }

        return [];
    }

    private buildSectionNodes(
        parsed: ParsedDocument,
        project: ProjectDefinition | null,
        sourceUri: vscode.Uri
    ): ProjectsTreeNode[] {
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
            if (project) {
                if (getEffectiveProject(it) === project.name) {
                    buckets[sect].push(it);
                }
            } else {
                if (getEffectiveProject(it) === undefined) {
                    buckets[sect].push(it);
                }
            }
        });

        const result: ProjectsTreeNode[] = [];
        for (const sect of ['active', 'completed', 'archive'] as const) {
            if (buckets[sect].length > 0) {
                result.push({
                    kind: 'project-section',
                    project,
                    section: sect,
                    items: buckets[sect],
                    sourceUri,
                });
            }
        }
        return result;
    }

    private countItemsForProject(
        parsed: ParsedDocument,
        projectName: string
    ): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (getEffectiveProject(it) !== projectName) {
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

    private countNoProject(parsed: ParsedDocument): {
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
            if (getEffectiveProject(it) !== undefined) {
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

export async function focusOnProjectFromTree(node?: ProjectsTreeNode) {
    if (node?.kind !== 'project-root') {
        vscode.window.showWarningMessage('Right-click a project in the MD Todo Projects view.');
        return;
    }
    await setFocusProjectState(node.project.name);
    refreshFocusProjectStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        updateDimDecorations(visible);
    }
}

export async function clearProjectFocusFromTree() {
    await setFocusProjectState(undefined);
    refreshFocusProjectStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
}

export async function markDoneFromProjectsTree(
    treeProvider: MdTodoProjectsTreeProvider,
    node?: ProjectsTreeNode
) {
    if (node?.kind !== 'project-todo') {
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

export async function showProjectViewFromTree(node?: ProjectsTreeNode) {
    if (node?.kind !== 'project-root') {
        vscode.window.showWarningMessage('Right-click a project in the MD Todo Projects view.');
        return;
    }
    await showProjectViewForProject(node.sourceUri, node.project);
}

export async function setProjectFromTree(node?: ProjectsTreeNode) {
    if (node?.kind !== 'project-todo') {
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Place cursor on the target line so setProject's findItemAtCursor picks it up.
    const pos = new vscode.Position(node.item.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await vscode.commands.executeCommand('mdTodo.setProject');
}
