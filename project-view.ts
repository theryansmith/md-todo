import * as vscode from 'vscode';
import { TodoItem, ParsedDocument, ProjectDefinition } from './types';
import {
    isTodoFile,
    parseDocument,
    getEffectiveEditor,
    getEffectiveProject,
    classifyItemSection,
} from './parser';

export interface ProjectViewNode {
    item: TodoItem;
    matchesProject: boolean;
    children: ProjectViewNode[];
}

/**
 * Prunes each top-level subtree down to nodes that belong to `projectName`
 * (by inheritance) plus whichever ancestors are needed to keep those nodes
 * reachable — so a task tagged deep inside an otherwise-unrelated subtree
 * still shows its parent chain for context. Pure — exported for unit tests.
 */
export function filterItemsForProject(items: TodoItem[], projectName: string): ProjectViewNode[] {
    const result: ProjectViewNode[] = [];
    for (const item of items) {
        const children = filterItemsForProject(item.children, projectName);
        const matchesProject = getEffectiveProject(item) === projectName;
        if (matchesProject || children.length > 0) {
            result.push({ item, matchesProject, children });
        }
    }
    return result;
}

function countMatches(node: ProjectViewNode): number {
    let n = node.matchesProject ? 1 : 0;
    for (const child of node.children) { n += countMatches(child); }
    return n;
}

function renderNode(node: ProjectViewNode, depth: number, lines: string[]): void {
    const indent = '  '.repeat(depth);
    const checkbox = node.item.isComplete ? '[x]' : '[ ]';
    let meta = '';
    if (node.item.addedDate) { meta += ` \`+${node.item.addedDate}\``; }
    if (node.item.completedDate) { meta += ` \`✓${node.item.completedDate}\``; }
    const context = node.matchesProject ? '' : ' _(context)_';
    lines.push(`${indent}- ${checkbox} ${node.item.text}${meta}${context}`);
    for (const note of node.item.notes) {
        lines.push(`${indent}  ${note}`);
    }
    for (const child of node.children) {
        renderNode(child, depth + 1, lines);
    }
}

const SECTIONS: Array<{ key: 'active' | 'completed' | 'archive'; label: string }> = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
    { key: 'archive', label: 'Archive' },
];

/**
 * Renders a read-only markdown report of every item belonging to `project`
 * (complete or not), grouped by Active/Completed/Archive and preserving the
 * parent/child hierarchy those items appear in. Pure — exported for unit tests.
 */
export function renderProjectView(parsed: ParsedDocument, project: ProjectDefinition): string {
    const lines: string[] = [`# 📁 Project View — ${project.name}`, ''];
    if (project.description) { lines.push(project.description, ''); }

    const bucketed: Record<'active' | 'completed' | 'archive', ProjectViewNode[]> = {
        active: [],
        completed: [],
        archive: []
    };
    for (const root of filterItemsForProject(parsed.items, project.name)) {
        const sect = classifyItemSection(root.item, parsed);
        if (sect) { bucketed[sect].push(root); }
    }

    let total = 0;
    for (const key of ['active', 'completed', 'archive'] as const) {
        for (const root of bucketed[key]) { total += countMatches(root); }
    }
    lines.push(`**Total:** ${total} item${total === 1 ? '' : 's'} in [${project.name}]`, '');

    for (const { key, label } of SECTIONS) {
        const roots = bucketed[key];
        if (roots.length === 0) { continue; }
        const sectionCount = roots.reduce((n, r) => n + countMatches(r), 0);
        lines.push(`## ${label} (${sectionCount})`, '');
        for (const root of roots) { renderNode(root, 0, lines); }
        lines.push('');
    }

    if (total === 0) { lines.push('_(no items in this project)_'); }

    return lines.join('\n');
}

async function openProjectViewDocument(parsed: ParsedDocument, project: ProjectDefinition): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
        content: renderProjectView(parsed, project),
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

export async function showProjectView(editor: vscode.TextEditor): Promise<void> {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }
    const parsed = parseDocument(ctx.document);
    if (parsed.projectDefinitions.length === 0) {
        vscode.window.showInformationMessage('No projects defined. Add a "## Projects" section first.');
        return;
    }

    type ProjectPick = vscode.QuickPickItem & { project: ProjectDefinition };
    const picks: ProjectPick[] = [...parsed.projectDefinitions]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map(p => ({ label: `$(project) ${p.name}`, detail: p.description, project: p }));

    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Pick a project to view',
        matchOnDetail: true,
    });
    if (!picked) { return; }

    await openProjectViewDocument(parsed, picked.project);
}

/** Invoked from the MD TODO PROJECTS tree's context menu, where the project is already known. */
export async function showProjectViewForProject(sourceUri: vscode.Uri, project: ProjectDefinition): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(sourceUri);
    const parsed = parseDocument(doc);
    await openProjectViewDocument(parsed, project);
}
