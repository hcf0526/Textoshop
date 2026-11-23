import { useEffect } from 'react';
import { onEditorEnter, onEditorLeave, useDocumentStore } from '../model/DocumentModel';
import { useChromeStore } from './ChromeModel';
import MenuBar from './MenuBar';
import TextoshopInterface from './TextoshopInterface';

// 编辑界面，顶部为菜单栏，用户实验等其他页面直接使用 TextoshopInterface，没有菜单栏
export default function EditorPage() {
    const setMenuBarVisible = useChromeStore((s) => s.setMenuBarVisible);
    // 切换文档时重新挂载编辑器，避免文本框沿用上一篇文档的内容
    const docId = useDocumentStore((s) => s.current?.id);
    useEffect(() => {
        setMenuBarVisible(true);
        onEditorEnter().catch((e) => console.error(e));
        return () => {
            onEditorLeave();
            setMenuBarVisible(false);
        };
    }, [setMenuBarVisible]);
    return <>
        <MenuBar />
        <TextoshopInterface key={docId ?? 'none'} />
    </>;
}
