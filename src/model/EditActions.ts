import { TextSelection, useModelStore } from './Model';

// 剪切、复制、粘贴，作用于当前选区，右键菜单与编辑菜单共用

export function hasSelection(): boolean {
    return useModelStore.getState().selectedTexts.length > 0;
}

export function copySelection() {
    const selectedTexts = useModelStore.getState().selectedTexts;
    if (selectedTexts.length > 0) navigator.clipboard.writeText(selectedTexts.map(t => t.text).join(" "));
}

export function cutSelection() {
    const selectedTexts = useModelStore.getState().selectedTexts;
    if (selectedTexts.length === 0) return;
    navigator.clipboard.writeText(selectedTexts.map(t => t.text).join(" "));
    useModelStore.getState().setSelectedTexts(selectedTexts.map(t => ({ ...t, text: "", isLoading: false })));
    useModelStore.getState().setSelectedTexts([]);
}

export function pasteIntoSelection() {
    navigator.clipboard.readText().then(text => {
        const selectedTexts = useModelStore.getState().selectedTexts;
        if (selectedTexts.length === 0) return;
        const newSelection: TextSelection[] = selectedTexts.map(t => ({ ...t, text, isLoading: false }));
        useModelStore.getState().setSelectedTexts(newSelection);
        useModelStore.getState().setSelectedTexts([]);
    });
}
