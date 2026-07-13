import * as vscode from 'vscode';

export interface TodoItem {
    line: number;
    text: string;
    isComplete: boolean;
    addedDate?: string;
    completedDate?: string;
    notes: string[];
    raw: string;
    indent: number;
    tags: string[];
    mentions: string[];
    /** Project from the first `[name]` token on the line, if any. */
    project?: string;
    children: TodoItem[];
    parent?: TodoItem;
}

export interface TagDefinition {
    name: string;
    description: string;
    line: number;
}

export interface UserDefinition {
    shortname: string;
    fullname: string;
    description: string;
    line: number;
}

export interface ProjectDefinition {
    name: string;
    description: string;
    line: number;
}

export interface ParsedDocument {
    items: TodoItem[];
    sections: Map<string, { start: number; end: number }>;
    tagDefinitions: TagDefinition[];
    userDefinitions: UserDefinition[];
    projectDefinitions: ProjectDefinition[];
}

export interface TagValidationResult {
    validTags: string[];
    undefinedTags: string[];
}

export interface EffectiveEditorContext {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
}

export type ActivityKind = 'completed' | 'added' | 'stale';

export interface ActivityFocus {
    kind: ActivityKind;
    startDate?: string;
    endDate?: string;
    staleDays?: number;
    label: string;
}

export type SuggestionItem = vscode.QuickPickItem & { insertText: string };

export type UserNode = {
    kind: 'user';
    user: UserDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type SectionNode = {
    kind: 'section';
    user: UserDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
};

export type TodoNode = {
    kind: 'todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
};

export type UnassignedNode = {
    kind: 'unassigned';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type TreeNode = UserNode | SectionNode | TodoNode | UnassignedNode;

export type TagRootNode = {
    kind: 'tag-root';
    tag: TagDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type TagSectionNode = {
    kind: 'tag-section';
    tag: TagDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
};

export type TagTodoNode = {
    kind: 'tag-todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
};

export type UntaggedNode = {
    kind: 'untagged';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type TagsTreeNode = TagRootNode | TagSectionNode | TagTodoNode | UntaggedNode;

export type ProjectRootNode = {
    kind: 'project-root';
    project: ProjectDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type ProjectSectionNode = {
    kind: 'project-section';
    project: ProjectDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
};

export type ProjectTodoNode = {
    kind: 'project-todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
};

export type NoProjectNode = {
    kind: 'no-project';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

export type ProjectsTreeNode = ProjectRootNode | ProjectSectionNode | ProjectTodoNode | NoProjectNode;
