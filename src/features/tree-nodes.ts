import * as vscode from 'vscode';
import { TodoItem, TagDefinition, UserDefinition, ProjectDefinition } from '../core/model';

// Tree-node unions for the activity-bar views. They carry `vscode.Uri`, so they
// live at the feature layer (the host-free domain model is in core/model.ts).
// One shared file for now — Phase 3c's generic grouping tree consumes these.

export interface UserNode {
    kind: 'user';
    user: UserDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export interface SectionNode {
    kind: 'section';
    user: UserDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
}

export interface TodoNode {
    kind: 'todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
}

export interface UnassignedNode {
    kind: 'unassigned';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export type TreeNode = UserNode | SectionNode | TodoNode | UnassignedNode;

export interface TagRootNode {
    kind: 'tag-root';
    tag: TagDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export interface TagSectionNode {
    kind: 'tag-section';
    tag: TagDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
}

export interface TagTodoNode {
    kind: 'tag-todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
}

export interface UntaggedNode {
    kind: 'untagged';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export type TagsTreeNode = TagRootNode | TagSectionNode | TagTodoNode | UntaggedNode;

export interface ProjectRootNode {
    kind: 'project-root';
    project: ProjectDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export interface ProjectSectionNode {
    kind: 'project-section';
    project: ProjectDefinition | null;
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
}

export interface ProjectTodoNode {
    kind: 'project-todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
}

export interface NoProjectNode {
    kind: 'no-project';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
}

export type ProjectsTreeNode =
    ProjectRootNode | ProjectSectionNode | ProjectTodoNode | NoProjectNode;
