import { BaseEditor, BaseRange, Editor, Node, Path, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { create } from 'zustand';
import { textFieldEditors, useModelStore } from './Model';
import { useUndoModelStore } from './UndoModel';

// 待写回的改写任务
// 发请求时给目标文字打上 pendingId 标记，这个标记与选区无关，点别处或重新选择都保留
// 结果回来后按标记找到原文并替换，因此可以同时改写多处
// 等待期间原文被用户改动或删除时放弃结果，状态记为 modified
// 每个任务结束后保留 5 秒，供请求计时器显示结果

export type JobStatus = 'running' | 'success' | 'error' | 'modified';

export interface Job {
    id: string
    original: string
    status: JobStatus
    startedAt: number
    endedAt?: number
}

type SlateEditor = BaseEditor & ReactEditor;

const RESULT_VISIBLE_MS = 5000;
export const PENDING_KEYS = ['pendingId', 'pendingClassname'];

interface PendingState {
    jobs: Record<string, Job>
}

export const usePendingStore = create<PendingState>()(() => ({ jobs: {} }));

let counter = 0;

function setJob(id: string, changes: Partial<Job>) {
    usePendingStore.setState((s) => s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...changes } } } : s);
}

function finish(id: string, status: JobStatus) {
    setJob(id, { status, endedAt: Date.now() });
    setTimeout(() => {
        usePendingStore.setState((s) => {
            const jobs = { ...s.jobs };
            delete jobs[id];
            return { jobs };
        });
    }, RESULT_VISIBLE_MS);
}

export function isJobRunning(id: string | undefined): boolean {
    return !!id && usePendingStore.getState().jobs[id]?.status === 'running';
}

// 给编辑器里的一段文字打上标记，返回任务编号，文字为空时返回 null
export function startJob(editor: SlateEditor, range: BaseRange, className = 'pending'): string | null {
    const original = Editor.string(editor, range);
    if (original.length === 0) return null;
    const id = `job${Date.now().toString(36)}${(counter++).toString(36)}`;
    Transforms.setNodes(editor, { pendingId: id, pendingClassname: className } as any, { at: range, match: Text.isText, split: true });
    usePendingStore.setState((s) => ({ jobs: { ...s.jobs, [id]: { id, original, status: 'running', startedAt: Date.now() } } }));
    return id;
}

// 以某个选区的文字为目标
export function startJobForSelection(selectionId: number, className = 'pending'): string | null {
    for (const editor of Object.values(textFieldEditors)) {
        const nodes = Array.from(Editor.nodes(editor, { at: [], match: (n: any) => Text.isText(n) && (n as any).selectionId === selectionId }));
        if (nodes.length === 0) continue;
        const range = { anchor: Editor.start(editor, nodes[0][1]), focus: Editor.end(editor, nodes[nodes.length - 1][1]) };
        return startJob(editor, range, className);
    }
    return null;
}

function findJob(id: string): { editor: SlateEditor, paths: Path[], text: string } | null {
    for (const editor of Object.values(textFieldEditors)) {
        const nodes = Array.from(Editor.nodes(editor, { at: [], match: (n: any) => Text.isText(n) && (n as any).pendingId === id }));
        if (nodes.length > 0) {
            return { editor, paths: nodes.map(([, p]) => p), text: nodes.map(([n]) => Node.string(n)).join('') };
        }
    }
    return null;
}

function unmark(id: string) {
    for (const editor of Object.values(textFieldEditors)) {
        Transforms.unsetNodes(editor, PENDING_KEYS, { at: [], mode: 'all', match: (n: any) => Text.isText(n) && (n as any).pendingId === id });
    }
}

// 用新文字替换任务标记的原文
// undoLabel 为 null 时不记撤销，用于调用方已在请求前记过的情况
export function applyJob(id: string | null, newText: string, undoLabel: string | null): boolean {
    if (!id || !isJobRunning(id)) return false;
    const found = findJob(id);
    const job = usePendingStore.getState().jobs[id];
    if (!found || found.text !== job.original) {
        unmark(id);
        finish(id, 'modified');
        return false;
    }
    if (undoLabel !== null) useUndoModelStore.getState().storeUndoState(undoLabel);
    useModelStore.getState().animateNextChanges();

    const { editor, paths } = found;
    Editor.withoutNormalizing(editor, () => {
        // 从后往前删除后面的片段，把新文字写进第一个片段，保留它的其他属性
        for (let i = paths.length - 1; i >= 1; i--) Transforms.removeNodes(editor, { at: paths[i] });
        Transforms.insertText(editor, newText, { at: Editor.range(editor, paths[0]) });
    });
    unmark(id);
    finish(id, 'success');
    return true;
}

// 请求成功但不改动文字，例如语气吸管
export function completeJob(id: string | null) {
    if (!id || !isJobRunning(id)) return;
    unmark(id);
    finish(id, 'success');
}

export function failJob(id: string | null) {
    if (!id || !isJobRunning(id)) return;
    unmark(id);
    finish(id, 'error');
}

// 常用写法，请求结果替换原文，失败时记为失败
export function runJob(id: string | null, request: Promise<string>, undoLabel: string | null): Promise<boolean> {
    return request.then(
        (text) => applyJob(id, text, undoLabel),
        (error) => {
            console.error(error);
            failJob(id);
            return false;
        },
    );
}
