import { create } from 'zustand';
import { zh } from './zh';

// 界面双语。源码里的英文原文即为键，中文译文放在 zh.ts，缺译时显示英文原文。
// 组件内用 useT() 取翻译函数，切换语言后自动重渲染，非组件代码用 tr()。

export type Language = 'en' | 'zh';

const STORAGE_KEY = 'textoshop.lang';

function initialLanguage(): Language {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

interface LanguageState {
    lang: Language
    setLang: (lang: Language) => void
    toggle: () => void
}

export const useLanguageStore = create<LanguageState>()((set, get) => ({
    lang: initialLanguage(),
    setLang: (lang) => {
        localStorage.setItem(STORAGE_KEY, lang);
        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
        set({ lang });
    },
    toggle: () => get().setLang(get().lang === 'zh' ? 'en' : 'zh'),
}));

document.documentElement.lang = useLanguageStore.getState().lang === 'zh' ? 'zh-CN' : 'en';

// 占位符写作 {name}，例如 tr('Signed in as {user}', { user })
function translate(lang: Language, text: string, vars?: Record<string, string | number>): string {
    let out = lang === 'zh' ? (zh[text] ?? text) : text;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    }
    return out;
}

export function tr(text: string, vars?: Record<string, string | number>): string {
    return translate(useLanguageStore.getState().lang, text, vars);
}

export function useT() {
    const lang = useLanguageStore((s) => s.lang);
    return (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars);
}
