import { Node } from 'slate';
import { create } from 'zustand';
import { tr } from '../i18n';
import { useModelStore } from './Model';
import { useUndoModelStore } from './UndoModel';
import { useChromeStore } from '../view/ChromeModel';

// 文档管理，文档按账号存在服务端 /api/docs，账号之间互相隔离
// 文档内容为编辑器状态（图层、文本框、选中的图层、语气），撤销记录不保存
// 有改动时每 5 秒自动保存一次，Ctrl+S 立即保存

export interface DocMeta {
    id: string
    title: string
    createdAt: number
    updatedAt: number
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_MS = 5000;
const FILE_FORMAT = 'textoshop';
const CONTENT_VERSION = 1;
// 选区、改写任务与动画用的临时属性不进入文档
const TRANSIENT_KEYS = new Set(['selection', 'selectionId', 'selectionClassname', 'pendingId', 'pendingClassname', 'differences', 'removed', 'added']);

export function serializeDocument() {
    const s = useModelStore.getState();
    const content = { version: CONTENT_VERSION, layers: s.layers, textFields: s.textFields, selectedLayerId: s.selectedLayerId, tone: s.tone };
    return JSON.parse(JSON.stringify(content, (k, v) => TRANSIENT_KEYS.has(k) ? undefined : v));
}

let applying = false;

function applyDocument(content: any) {
    applying = true;
    try {
        const model = useModelStore.getState();
        model.setSelectedTexts([]);
        model.reset();
        if (content?.layers && content?.textFields) {
            useModelStore.setState({
                layers: content.layers,
                textFields: content.textFields,
                selectedLayerId: content.selectedLayerId ?? 0,
                ...(content.tone ? { tone: content.tone } : {}),
            });
        }
        useModelStore.getState().refreshTextFields(true);
        useUndoModelStore.getState().reset();
    } finally {
        // 编辑器在下一帧才同步完，之后的变化才算用户改动
        setTimeout(() => { applying = false; }, 300);
    }
}

// 空白文档，只有一个空图层
function blankContent() {
    applyDocument({
        layers: [{ id: "1", layer: { name: "Layer 1", color: "white", isVisible: true, modifications: {}, state: [{ type: "paragraph", children: [{ text: "" }] }] }, children: [] }],
        textFields: useModelStore.getState().textFields.filter(t => t.id === 'mainTextField'),
    });
    return serializeDocument();
}

// 页面上可见的全部文字，主文本在前，其余文本框依次在后
export function documentText(): string {
    return useModelStore.getState().textFields
        .filter(t => t.isVisible)
        .sort((a, b) => (a.id === 'mainTextField' ? -1 : b.id === 'mainTextField' ? 1 : 0))
        .map(t => t.state.map(n => Node.string(n)).join('\n').trim())
        .filter(text => text.length > 0)
        .join('\n\n');
}

function lastDocKey(user: string) {
    return `textoshop.lastDoc.${user}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as T;
}

interface DocumentState {
    user: string | null
    current: DocMeta | null
    list: DocMeta[]
    status: SaveStatus
    dirty: boolean
    init: (user: string) => Promise<void>
    clear: () => void
    refreshList: () => Promise<void>
    open: (id: string) => Promise<void>
    createBlank: () => Promise<void>
    createFrom: (title: string, content: any) => Promise<void>
    save: () => Promise<void>
    rename: (title: string) => Promise<void>
    remove: (id: string) => Promise<void>
}

export const useDocumentStore = create<DocumentState>()((set, get) => ({
    user: null,
    current: null,
    list: [],
    status: 'saved',
    dirty: false,

    // 登录后调用，打开上次的文档，没有文档时用当前示例创建一篇
    init: async (user) => {
        set({ user });
        await get().refreshList();
        const list = get().list;
        if (list.length === 0) {
            const doc = await api<DocMeta & { content: any }>('/api/docs', { method: 'POST', body: JSON.stringify({ title: tr('Sample document'), content: serializeDocument() }) });
            set({ current: doc, list: [doc], status: 'saved', dirty: false });
            localStorage.setItem(lastDocKey(user), doc.id);
            return;
        }
        const last = localStorage.getItem(lastDocKey(user));
        await get().open(list.find(d => d.id === last)?.id ?? list[0].id);
    },

    clear: () => set({ user: null, current: null, list: [], status: 'saved', dirty: false }),

    refreshList: async () => {
        const { docs } = await api<{ docs: DocMeta[] }>('/api/docs');
        set({ list: docs });
    },

    open: async (id) => {
        if (get().dirty) await get().save();
        const doc = await api<DocMeta & { content: any }>(`/api/docs/${id}`);
        applyDocument(doc.content);
        const { content, ...meta } = doc;
        set({ current: meta, status: 'saved', dirty: false });
        const user = get().user;
        if (user) localStorage.setItem(lastDocKey(user), id);
    },

    createBlank: async () => {
        if (get().dirty) await get().save();
        await get().createFrom(tr('Untitled'), blankContent());
    },

    createFrom: async (title, content) => {
        if (get().dirty) await get().save();
        const doc = await api<DocMeta & { content: any }>('/api/docs', { method: 'POST', body: JSON.stringify({ title, content }) });
        await get().refreshList();
        await get().open(doc.id);
    },

    save: async () => {
        const current = get().current;
        if (!current || get().status === 'saving') return;
        set({ status: 'saving', dirty: false });
        try {
            const meta = await api<DocMeta>(`/api/docs/${current.id}`, { method: 'PUT', body: JSON.stringify({ content: serializeDocument() }) });
            // 保存期间又有改动时保持未保存状态
            set((s) => ({ current: s.current?.id === meta.id ? meta : s.current, status: s.dirty ? 'dirty' : 'saved' }));
        } catch {
            set({ status: 'error', dirty: true });
        }
    },

    rename: async (title) => {
        const current = get().current;
        const clean = title.trim();
        if (!current || !clean || clean === current.title) return;
        const meta = await api<DocMeta>(`/api/docs/${current.id}`, { method: 'PUT', body: JSON.stringify({ title: clean }) });
        set({ current: meta });
        await get().refreshList();
    },

    remove: async (id) => {
        await api(`/api/docs/${id}`, { method: 'DELETE' });
        await get().refreshList();
        if (get().current?.id === id) {
            set({ current: null, dirty: false });
            const next = get().list[0];
            if (next) await get().open(next.id);
            else await get().createBlank();
        }
    },
}));

// 编辑器内容变化时标记为未保存，只统计编辑界面里的改动，示例页与用户实验页的改动不算
useModelStore.subscribe((state, prev) => {
    if (applying || !useDocumentStore.getState().current || !useChromeStore.getState().menuBarVisible) return;
    if (state.layers !== prev.layers || state.textFields !== prev.textFields || state.tone !== prev.tone || state.selectedLayerId !== prev.selectedLayerId) {
        useDocumentStore.setState((s) => ({ dirty: true, status: s.status === 'saving' ? 'saving' : 'dirty' }));
    }
});

setInterval(() => {
    const s = useDocumentStore.getState();
    if (s.dirty && s.current && s.status !== 'saving' && useChromeStore.getState().menuBarVisible) s.save();
}, AUTOSAVE_MS);

// 从示例页打开示例时，进入编辑界面后另存为新文档
let pendingExample = false;
export function markExampleOpening() {
    pendingExample = true;
}

// 编辑界面挂载时调用，离开过编辑界面再回来时重新载入当前文档
let leftEditor = false;
export async function onEditorEnter() {
    const store = useDocumentStore.getState();
    if (pendingExample) {
        pendingExample = false;
        leftEditor = false;
        if (store.user) await store.createFrom(tr('Sample document'), serializeDocument());
        return;
    }
    if (leftEditor && store.current) await store.open(store.current.id);
    leftEditor = false;
}

// 编辑界面卸载时调用，先保存未保存的改动
export function onEditorLeave() {
    leftEditor = true;
    const store = useDocumentStore.getState();
    if (store.dirty && store.current) store.save();
}

// 关闭页面前有未保存的改动时提示
window.addEventListener('beforeunload', (e) => {
    if (useDocumentStore.getState().dirty) {
        useDocumentStore.getState().save();
        e.preventDefault();
        e.returnValue = '';
    }
});

// 下载与导出

function safeFileName(title: string) {
    return (title || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function download(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentTitle() {
    return useDocumentStore.getState().current?.title ?? tr('Untitled');
}

export function downloadDocument() {
    const data = { format: FILE_FORMAT, version: CONTENT_VERSION, title: currentTitle(), exportedAt: new Date().toISOString(), content: serializeDocument() };
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${safeFileName(currentTitle())}.textoshop.json`);
}

export function exportText() {
    download(new Blob([documentText() + '\n'], { type: 'text/plain;charset=utf-8' }), `${safeFileName(currentTitle())}.txt`);
}

export function exportMarkdown() {
    download(new Blob([`# ${currentTitle()}\n\n${documentText()}\n`], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(currentTitle())}.md`);
}

export async function exportWord() {
    // 按需加载 docx，避免拖慢首屏
    const { Document, HeadingLevel, Packer, Paragraph } = await import('docx');
    const body = documentText().split('\n').map(line => new Paragraph({ text: line }));
    const doc = new Document({ sections: [{ children: [new Paragraph({ text: currentTitle(), heading: HeadingLevel.HEADING_1 }), ...body] }] });
    download(await Packer.toBlob(doc), `${safeFileName(currentTitle())}.docx`);
}

// 导入下载的 .textoshop.json，作为新文档打开，格式错误时返回 false
export async function importDocument(file: File): Promise<boolean> {
    try {
        const data = JSON.parse(await file.text());
        if (data?.format !== FILE_FORMAT || !data.content?.layers) return false;
        await useDocumentStore.getState().createFrom(data.title || file.name.replace(/\.textoshop\.json$|\.json$/, ''), data.content);
        return true;
    } catch {
        return false;
    }
}
