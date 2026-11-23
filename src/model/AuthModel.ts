import { create } from 'zustand';
import { useDocumentStore } from './DocumentModel';
import { useSettingsStore } from './SettingsModel';

// 登录状态，会话保存在服务端签发的 HttpOnly Cookie 里，前端只记录用户名
// 登录成功后载入该账号的大模型配置，载入完成才进入编辑界面

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';
export type LoginError = 'invalid' | 'locked' | 'network';

interface AuthState {
    status: AuthStatus
    user: string | null
    refresh: () => Promise<void>
    login: (username: string, password: string) => Promise<LoginError | null>
    logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set) => ({
    status: 'loading',
    user: null,

    refresh: async () => {
        try {
            const res = await fetch('/api/me', { credentials: 'same-origin' });
            if (res.ok) {
                const { user } = await res.json();
                await useSettingsStore.getState().load();
                set({ status: 'authenticated', user });
                return;
            }
        } catch {
            /* 后端不可达时按未登录处理 */
        }
        set({ status: 'anonymous', user: null });
    },

    login: async (username, password) => {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            if (res.ok) {
                const { user } = await res.json();
                await useSettingsStore.getState().load();
                set({ status: 'authenticated', user });
                return null;
            }
            return res.status === 429 ? 'locked' : 'invalid';
        } catch {
            return 'network';
        }
    },

    logout: async () => {
        // 退出前保存未保存的改动
        if (useDocumentStore.getState().dirty) await useDocumentStore.getState().save();
        try {
            await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
        } finally {
            useSettingsStore.getState().clear();
            set({ status: 'anonymous', user: null });
            window.location.hash = '/';
        }
    },
}));
