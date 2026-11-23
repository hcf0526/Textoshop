import { create } from 'zustand';
import { useStudyStore } from '../study/StudyModel';
import { ModelState, useModelStore } from './Model';

// 快照里去掉改写任务的标记，撤销时不会恢复出已失效的「处理中」状态
const snapshotReplacer = (key: string, value: unknown) => (key === 'pendingId' || key === 'pendingClassname') ? undefined : value;
function snapshot(): string {
    return JSON.stringify(useModelStore.getState(), snapshotReplacer);
}

// 历史记录条目，与 undoStack/redoStack 一一对应，记录该快照之后发生的操作
export interface HistoryMeta {
    label: string   // 英文原文，显示时翻译
    time: number
}



/** 
 * Model 
 **/
interface UndoModelState {
    undoStack : ModelState[];
    redoStack : ModelState[];
    undoMeta : HistoryMeta[];
    redoMeta : HistoryMeta[];
    sessionStart : number;
    lastStoredStateTimestamp : number;
    isDisabled : boolean;
}

interface UndoModelAction {
    reset: () => void
    undo: () => void
    redo: () => void
    storeUndoState: (label?: string) => void
    storeUndoStateDebounced: () => void
    jumpTo: (index: number) => void
    setIsDisabled: (isDisabled: boolean) => void
}

function getInitialState() : UndoModelState {
    return {
        undoStack: [],
        redoStack: [],
        undoMeta: [],
        redoMeta: [],
        sessionStart: Date.now(),
        lastStoredStateTimestamp: 0,
        isDisabled: false
    }
}


export const useUndoModelStore = create<UndoModelState & UndoModelAction>()((set, get) => ({
    ...getInitialState(),
    reset: () => set((state) => ({ ...getInitialState() })),
    undo: () => {
        const { undoStack, redoStack, undoMeta, redoMeta } = get();
        if (undoStack.length > 0) {
            const newState = undoStack.pop();
            if (newState) {
                const modelState = JSON.parse(snapshot());
                redoStack.push(modelState);
                const meta = undoMeta.pop();
                if (meta) redoMeta.push(meta);
                set((state) => ({ undoStack: undoStack, redoStack: redoStack, undoMeta: [...undoMeta], redoMeta: [...redoMeta], isDisabled: true }));
                useModelStore.setState(JSON.parse(JSON.stringify(newState)));
                useModelStore.getState().animateNextChanges();
                useModelStore.getState().refreshTextFields();
                set((state) => ({ isDisabled: false }));
                useStudyStore.getState().logEvent("UNDO", { undoStackLength: undoStack.length, redoStackLength: redoStack.length });
            }
        }
    },

    redo: () => {
        const { undoStack, redoStack, undoMeta, redoMeta } = get();
        if (redoStack.length > 0) {
            const newState = redoStack.pop();
            if (newState) {
                const modelState = JSON.parse(snapshot());
                undoStack.push(modelState);
                const meta = redoMeta.pop();
                if (meta) undoMeta.push(meta);
                set((state) => ({ undoStack: undoStack, redoStack: redoStack, undoMeta: [...undoMeta], redoMeta: [...redoMeta], isDisabled: true}));
                useModelStore.setState(JSON.parse(JSON.stringify(newState)));
                useModelStore.getState().animateNextChanges();
                useModelStore.getState().refreshTextFields();
                set((state) => ({ isDisabled: false }));
                useStudyStore.getState().logEvent("REDO", { undoStackLength: undoStack.length, redoStackLength: redoStack.length });
            }
        }
    },

    // label 省略时用当前选中的工具名
    storeUndoState: (label?: string) => {
        const { undoStack, undoMeta } = get();
        const modelState = JSON.parse(snapshot());
        undoStack.push(modelState);
        const meta = { label: label ?? useModelStore.getState().selectedTool, time: Date.now() };
        set((state) => ({ undoStack: undoStack, redoStack: [], undoMeta: [...undoMeta, meta], redoMeta: [], lastStoredStateTimestamp: Date.now() }));
    },

    // 跳到历史记录第 index 步，0 为打开时的状态，undoMeta.length 为当前状态
    jumpTo: (index: number) => {
        const current = get().undoMeta.length;
        const steps = index - current;
        for (let i = 0; i < Math.abs(steps); i++) {
            if (steps < 0) get().undo();
            else get().redo();
        }
    },

    storeUndoStateDebounced: () => {
        const { lastStoredStateTimestamp, isDisabled } = get();
        const now = Date.now();
        if (now - lastStoredStateTimestamp > 1000) {
            if (!isDisabled) {
                const stringifiedState = snapshot();
                const lastStringifiedState = get().undoStack.length > 0 ? JSON.stringify(get().undoStack[get().undoStack.length - 1]) : "";

                if (stringifiedState !== lastStringifiedState) {
                    const modelState = JSON.parse(stringifiedState);
                    set((state) => ({ undoStack: [...state.undoStack, modelState], redoStack: [],
                        undoMeta: [...state.undoMeta, { label: 'Edit text', time: now }], redoMeta: [], lastStoredStateTimestamp: now }));
                }
            }
        } else {
            set((state) => ({ lastStoredStateTimestamp: now }));
        }
    },

    setIsDisabled: (isDisabled: boolean) => set((state) => ({ isDisabled: isDisabled }))
}))


//         
