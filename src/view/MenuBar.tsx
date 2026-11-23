import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@nextui-org/react';
import { useEffect, useRef, useState } from 'react';
import { FaPaintBrush, FaRegFileAlt, FaTrashAlt } from 'react-icons/fa';
import { useLanguageStore, useT } from '../i18n';
import { useAuthStore } from '../model/AuthModel';
import { downloadDocument, exportMarkdown, exportText, exportWord, importDocument, useDocumentStore } from '../model/DocumentModel';
import { copySelection, cutSelection, hasSelection, pasteIntoSelection } from '../model/EditActions';
import { useModelStore } from '../model/Model';
import { useUndoModelStore } from '../model/UndoModel';
import { MENU_BAR_HEIGHT, useChromeStore } from './ChromeModel';

// 顶部菜单栏，含文档、编辑、设置、关于四个菜单，以及文档标题、保存状态与当前账号

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k: string, shift = false) => isMac ? `${shift ? '⇧' : ''}⌘${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`;

const STATUS_TEXT = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving', error: 'Save failed' } as const;

function formatTime(ms: number) {
    return new Date(ms).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function MenuBar() {
    const t = useT();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const lang = useLanguageStore((s) => s.lang);
    const setLang = useLanguageStore((s) => s.setLang);
    const current = useDocumentStore((s) => s.current);
    const status = useDocumentStore((s) => s.status);
    const openDialog = useChromeStore((s) => s.openDialog);
    const canUndo = useUndoModelStore((s) => s.undoStack.length > 0);
    const canRedo = useUndoModelStore((s) => s.redoStack.length > 0);
    const selection = useModelStore((s) => s.selectedTexts.length > 0);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    function flash(text: string) {
        setNotice(text);
        setTimeout(() => setNotice(null), 5000);
    }

    async function run(action: () => Promise<unknown> | unknown) {
        try {
            await action();
        } catch (e) {
            console.error(e);
            flash('Operation failed');
        }
    }

    // Ctrl+S 保存，Ctrl+O 打开文档列表
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const k = e.key.toLowerCase();
            if (k === 's') {
                e.preventDefault();
                run(() => useDocumentStore.getState().save());
            } else if (k === 'o') {
                e.preventDefault();
                openDialog('documents');
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    function onDocumentAction(k: React.Key) {
        const store = useDocumentStore.getState();
        switch (k) {
            case 'new': return run(() => store.createBlank());
            case 'open': return openDialog('documents');
            case 'save': return run(() => store.save());
            case 'rename': setTitleDraft(current?.title ?? ''); return setEditingTitle(true);
            case 'import': return fileInput.current?.click();
            case 'download': return downloadDocument();
            case 'txt': return exportText();
            case 'md': return exportMarkdown();
            case 'docx': return run(() => exportWord());
            case 'delete': return setConfirmDelete(true);
        }
    }

    function onEditAction(k: React.Key) {
        switch (k) {
            case 'undo': return useUndoModelStore.getState().undo();
            case 'redo': return useUndoModelStore.getState().redo();
            case 'cut': return cutSelection();
            case 'copy': return copySelection();
            case 'paste': return pasteIntoSelection();
        }
    }

    function onSettingsAction(k: React.Key) {
        switch (k) {
            case 'model': return openDialog('settings');
            case 'zh': return setLang('zh');
            case 'en': return setLang('en');
            case 'logout': return logout();
        }
    }

    function onAboutAction(k: React.Key) {
        switch (k) {
            case 'about': return openDialog('about');
            case 'paper': return window.open('https://arxiv.org/abs/2409.17088', '_blank', 'noopener');
            case 'source': return window.open('https://github.com/hcf0526/Textoshop', '_blank', 'noopener');
        }
    }

    function commitTitle() {
        setEditingTitle(false);
        run(() => useDocumentStore.getState().rename(titleDraft));
    }

    const menu = (label: string, children: React.ReactNode) => (
        <Dropdown placement="bottom-start">
            <DropdownTrigger>
                <Button size="sm" variant="light" radius="sm" style={{ minWidth: 0, paddingLeft: 10, paddingRight: 10, fontSize: 14 }}>{t(label)}</Button>
            </DropdownTrigger>
            {children as any}
        </Dropdown>
    );

    return <>
        <div style={{
            position: 'fixed', left: 0, right: 0, top: 0, height: MENU_BAR_HEIGHT, zIndex: 100000,
            display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px',
            background: 'white', borderBottom: '1px solid #e4e4e7',
        }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginRight: 10 }}><FaPaintBrush /> Textoshop</span>

            {menu('Document', <DropdownMenu aria-label={t('Document')} onAction={onDocumentAction} disabledKeys={current ? [] : ['save', 'rename', 'delete']}>
                <DropdownSection showDivider>
                    <DropdownItem key="new">{t('New')}</DropdownItem>
                    <DropdownItem key="open" shortcut={key('O')}>{t('Open')}</DropdownItem>
                    <DropdownItem key="save" shortcut={key('S')}>{t('Save')}</DropdownItem>
                    <DropdownItem key="rename">{t('Rename')}</DropdownItem>
                </DropdownSection>
                <DropdownSection showDivider>
                    <DropdownItem key="import">{t('Import')}</DropdownItem>
                    <DropdownItem key="download" description=".textoshop.json">{t('Download')}</DropdownItem>
                    <DropdownItem key="txt" description=".txt">{t('Export as TXT')}</DropdownItem>
                    <DropdownItem key="md" description=".md">{t('Export as Markdown')}</DropdownItem>
                    <DropdownItem key="docx" description=".docx">{t('Export as Word')}</DropdownItem>
                </DropdownSection>
                <DropdownSection>
                    <DropdownItem key="delete" className="text-danger" color="danger">{t('Delete document')}</DropdownItem>
                </DropdownSection>
            </DropdownMenu>)}

            {menu('Edit', <DropdownMenu aria-label={t('Edit')} onAction={onEditAction}
                disabledKeys={[...(canUndo ? [] : ['undo']), ...(canRedo ? [] : ['redo']), ...(selection && hasSelection() ? [] : ['cut', 'copy', 'paste'])]}>
                <DropdownSection showDivider>
                    <DropdownItem key="undo" shortcut={key('Z')}>{t('Undo')}</DropdownItem>
                    <DropdownItem key="redo" shortcut={isMac ? key('Z', true) : key('Y')}>{t('Redo')}</DropdownItem>
                </DropdownSection>
                <DropdownSection>
                    <DropdownItem key="cut" shortcut={key('X')}>{t('Cut')}</DropdownItem>
                    <DropdownItem key="copy" shortcut={key('C')}>{t('Copy')}</DropdownItem>
                    <DropdownItem key="paste" shortcut={key('V')}>{t('Paste')}</DropdownItem>
                </DropdownSection>
            </DropdownMenu>)}

            {menu('Settings', <DropdownMenu aria-label={t('Settings')} onAction={onSettingsAction}>
                <DropdownSection showDivider>
                    <DropdownItem key="model">{t('Model settings')}</DropdownItem>
                </DropdownSection>
                <DropdownSection title={t('Language')} showDivider>
                    <DropdownItem key="zh" endContent={lang === 'zh' ? '✓' : null}>中文</DropdownItem>
                    <DropdownItem key="en" endContent={lang === 'en' ? '✓' : null}>English</DropdownItem>
                </DropdownSection>
                <DropdownSection>
                    <DropdownItem key="logout" className="text-danger" color="danger">{t('Sign out')}</DropdownItem>
                </DropdownSection>
            </DropdownMenu>)}

            {menu('About', <DropdownMenu aria-label={t('About')} onAction={onAboutAction}>
                <DropdownItem key="about">{t('About Textoshop')}</DropdownItem>
                <DropdownItem key="paper" description="arXiv 2409.17088">{t('Original paper')}</DropdownItem>
                <DropdownItem key="source" description="GitHub">{t('Source code')}</DropdownItem>
            </DropdownMenu>)}

            {/* 文档标题，点击改名 */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {editingTitle
                    ? <Input size="sm" autoFocus value={titleDraft} onValueChange={setTitleDraft} style={{ width: 260 }}
                        onBlur={commitTitle} onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }} />
                    : <button type="button" onClick={() => { setTitleDraft(current?.title ?? ''); setEditingTitle(true); }}
                        style={{ fontSize: 14, fontWeight: 500, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {current?.title ?? ''}
                    </button>}
                {current && <span style={{ fontSize: 12, color: status === 'error' ? '#f31260' : '#a1a1aa', whiteSpace: 'nowrap' }}>{t(STATUS_TEXT[status])}</span>}
                {notice && <span style={{ fontSize: 12, color: '#f31260', whiteSpace: 'nowrap' }}>{t(notice)}</span>}
            </div>

            <span style={{ fontSize: 13, color: '#71717a' }}>{user}</span>
            <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file && !(await importDocument(file))) flash('Import failed');
            }} />
        </div>

        <DocumentsDialog />
        <AboutDialog />
        <Modal isOpen={confirmDelete} onOpenChange={setConfirmDelete} size="sm">
            <ModalContent>
                <ModalHeader>{t('Delete document')}</ModalHeader>
                <ModalBody><span style={{ fontWeight: 500 }}>{current?.title}</span></ModalBody>
                <ModalFooter>
                    <Button variant="light" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button>
                    <Button color="danger" onClick={() => { setConfirmDelete(false); if (current) run(() => useDocumentStore.getState().remove(current.id)); }}>{t('Delete')}</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    </>;
}

// 文档列表，点击打开，悬停显示删除
function DocumentsDialog() {
    const t = useT();
    const open = useChromeStore((s) => s.dialog === 'documents');
    const openDialog = useChromeStore((s) => s.openDialog);
    const list = useDocumentStore((s) => s.list);
    const current = useDocumentStore((s) => s.current);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setPendingDelete(null);
            useDocumentStore.getState().refreshList().catch(() => {});
        }
    }, [open]);

    const close = () => openDialog(null);

    return <Modal isOpen={open} onOpenChange={(v) => !v && close()} size="lg" scrollBehavior="inside">
        <ModalContent>
            <ModalHeader style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 48 }}>
                <span>{t('Documents')}</span>
                <Button size="sm" color="primary" variant="flat" onClick={() => { close(); useDocumentStore.getState().createBlank(); }}>{t('New')}</Button>
            </ModalHeader>
            <ModalBody style={{ paddingBottom: 20 }}>
                {list.map((doc) => {
                    const isCurrent = doc.id === current?.id;
                    return <div key={doc.id} className={isCurrent ? undefined : "hover:bg-default-100"}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: isCurrent ? '#D7E7FA' : undefined }}
                        onClick={() => { close(); if (!isCurrent) useDocumentStore.getState().open(doc.id); }}>
                        <FaRegFileAlt style={{ color: '#71717a', flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
                        <span style={{ fontSize: 12, color: '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}>{formatTime(doc.updatedAt)}</span>
                        {pendingDelete === doc.id
                            ? <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="light" onClick={() => setPendingDelete(null)}>{t('Cancel')}</Button>
                                <Button size="sm" color="danger" onClick={() => { setPendingDelete(null); useDocumentStore.getState().remove(doc.id); }}>{t('Delete')}</Button>
                            </span>
                            : <Button size="sm" isIconOnly variant="light" aria-label={t('Delete')} onClick={(e) => { e.stopPropagation(); setPendingDelete(doc.id); }}
                                style={{ color: "#a1a1aa" }}><FaTrashAlt /></Button>}
                    </div>;
                })}
            </ModalBody>
        </ModalContent>
    </Modal>;
}

// 关于，信息以表格列出
function AboutDialog() {
    const t = useT();
    const open = useChromeStore((s) => s.dialog === 'about');
    const openDialog = useChromeStore((s) => s.openDialog);
    const rows: [string, React.ReactNode][] = [
        ['Paper', 'Textoshop Interactions Inspired by Drawing Software to Facilitate Text Editing'],
        ['Venue', 'CHI 2025'],
        ['Authors', 'Damien Masson, Young-Ho Kim, Fanny Chevalier'],
        ['Upstream', <a href="https://github.com/m-damien/Textoshop" target="_blank" rel="noopener">m-damien/Textoshop</a>],
        ['This project', <a href="https://github.com/hcf0526/Textoshop" target="_blank" rel="noopener">hcf0526/Textoshop</a>],
        ['License', 'MIT'],
        ['Purpose', t('Ubiquitous and Edge Computing course project')],
    ];
    return <Modal isOpen={open} onOpenChange={(v) => !v && openDialog(null)} size="lg">
        <ModalContent>
            <ModalHeader style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FaPaintBrush /> {t('About Textoshop')}</ModalHeader>
            <ModalBody style={{ paddingBottom: 24 }}>
                <table style={{ fontSize: 14, borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                    <tbody>
                        {rows.map(([label, value]) => <tr key={label}>
                            <td style={{ color: '#71717a', paddingRight: 20, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{t(label)}</td>
                            <td>{value}</td>
                        </tr>)}
                    </tbody>
                </table>
            </ModalBody>
        </ModalContent>
    </Modal>;
}
