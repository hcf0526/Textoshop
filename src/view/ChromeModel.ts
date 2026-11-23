import { create } from 'zustand';

// 菜单栏与对话框的显示状态
// 编辑界面显示顶部菜单栏，其他页面仍用左下角的齿轮与语言按钮

export const MENU_BAR_HEIGHT = 40;

export type DialogName = 'settings' | 'documents' | 'about' | null;

interface ChromeState {
    menuBarVisible: boolean
    dialog: DialogName
    setMenuBarVisible: (visible: boolean) => void
    openDialog: (dialog: DialogName) => void
}

export const useChromeStore = create<ChromeState>()((set) => ({
    menuBarVisible: false,
    dialog: null,
    setMenuBarVisible: (menuBarVisible) => set({ menuBarVisible }),
    openDialog: (dialog) => set({ dialog }),
}));

// 编辑界面内容整体下移的距离
export function useTopOffset(): number {
    return useChromeStore((s) => s.menuBarVisible ? MENU_BAR_HEIGHT : 0);
}
