import { create } from 'zustand';
import { DEFAULT_TIMEOUT, setLLMConfig } from './LLMConfig';
import { clearPromptCache } from './PromptCache';

// 大模型配置，跟随账号保存在服务端 /api/settings，登录后自动载入
// API Key 只上传不下发，前端只知道是否已保存以及末 4 位

export interface LLMSettings {
    baseURL: string
    model: string
    timeout: number
    disableThinking: boolean
}

export type SaveError = 'bad_base_url' | 'bad_timeout' | 'failed';

const EMPTY: LLMSettings = { baseURL: '', model: '', timeout: DEFAULT_TIMEOUT, disableThinking: false };

interface SettingsState {
    loaded: boolean
    settings: LLMSettings
    apiKeySet: boolean
    apiKeyHint: string
    load: () => Promise<void>
    // apiKey 为空字符串时保留已保存的 Key
    save: (settings: LLMSettings, apiKey: string) => Promise<SaveError | null>
    clear: () => void
}

function apply(set: (s: Partial<SettingsState>) => void, data: any) {
    const settings: LLMSettings = {
        baseURL: data.baseURL ?? '',
        model: data.model ?? '',
        timeout: data.timeout ?? DEFAULT_TIMEOUT,
        disableThinking: !!data.disableThinking,
    };
    setLLMConfig({ baseURL: settings.baseURL, model: settings.model, timeout: settings.timeout });
    set({ settings, apiKeySet: !!data.apiKeySet, apiKeyHint: data.apiKeyHint ?? '' });
}

export const useSettingsStore = create<SettingsState>()((set) => ({
    loaded: false,
    settings: EMPTY,
    apiKeySet: false,
    apiKeyHint: '',

    load: async () => {
        try {
            const res = await fetch('/api/settings', { credentials: 'same-origin' });
            if (res.ok) apply(set, await res.json());
        } catch {
            /* 读取失败时沿用当前配置 */
        }
        set({ loaded: true });
    },

    save: async (settings, apiKey) => {
        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...settings, ...(apiKey ? { apiKey } : {}) }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                // 换了模型或服务后，旧的缓存结果作废
                clearPromptCache();
                apply(set, data);
                return null;
            }
            if (data.error === 'bad_base_url' || data.error === 'bad_timeout') return data.error;
            return 'failed';
        } catch {
            return 'failed';
        }
    },

    clear: () => {
        clearPromptCache();
        setLLMConfig({ baseURL: '', model: '', timeout: DEFAULT_TIMEOUT });
        set({ loaded: false, settings: EMPTY, apiKeySet: false, apiKeyHint: '' });
    },
}));
