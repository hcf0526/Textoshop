import OpenAI from 'openai';

// 大模型配置
// 浏览器不直接调用模型服务，所有请求发往本站 /api/llm/v1，由服务端带上当前账号保存的 Key 转发
// 这样不受模型服务跨域设置的限制，API Key 也只留在服务端
// Base URL、模型 ID、超时时间等跟随账号保存，登录后由 SettingsModel 载入

export const DEFAULT_MODEL = 'gpt-4o';
export const DEFAULT_TIMEOUT = 120; // 秒
export const PROXY_PATH = '/api/llm/v1';

export interface LLMConfig {
    baseURL: string // 模型服务地址，仅用于显示，实际由服务端转发，空字符串表示 OpenAI 官方地址
    model: string   // 空字符串表示沿用各工具默认模型
    timeout: number // 单次请求的总时长上限，单位秒，含重试与流式返回
}

// Base URL 只有域名时补上 /v1，兼容服务的接收地址大多在 /v1 下
export function normalizeBaseURL(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
        const url = new URL(trimmed);
        if (url.pathname === '' || url.pathname === '/') return trimmed + '/v1';
    } catch {
        /* 无法解析时原样返回，由服务端报错 */
    }
    return trimmed;
}

export const llmConfig: LLMConfig = {
    baseURL: '',
    model: '',
    timeout: DEFAULT_TIMEOUT,
};

// SDK 要求填写 apiKey，这里填占位值，服务端会忽略并换成账号保存的 Key
export const openai = new OpenAI({
    apiKey: 'proxy',
    baseURL: `${window.location.origin}${PROXY_PATH}`,
    timeout: DEFAULT_TIMEOUT * 1000,
    dangerouslyAllowBrowser: true
});

export function setLLMConfig(changes: Partial<LLMConfig>) {
    Object.assign(llmConfig, changes);
    llmConfig.baseURL = normalizeBaseURL(llmConfig.baseURL);
    llmConfig.model = llmConfig.model.trim();
    openai.timeout = llmConfig.timeout * 1000;
}

// 本次请求的中止信号，到达超时时间后中止，覆盖重试与流式返回的全过程
export function requestSignal(): AbortSignal {
    return AbortSignal.timeout(llmConfig.timeout * 1000);
}

// 自定义模型名会覆盖所有调用，未设置时使用调用方指定的模型或默认模型
export function resolveModel(requested?: string): string {
    return llmConfig.model || requested || DEFAULT_MODEL;
}
