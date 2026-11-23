// 大模型请求缓存，键为模型名、提示词与输出格式，值为请求的 Promise
// 相同请求复用结果，同时进行中的相同请求也只发一次
// 只存在当前页面内存里，按最近使用保留最多 200 条，保存模型设置或退出登录时清空

const LIMIT = 200;
const cache = new Map<string, Promise<any>>();

export function cachedRequest<T>(key: string, run: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit) {
        // 移到末尾，表示最近使用
        cache.delete(key);
        cache.set(key, hit);
        return hit as Promise<T>;
    }
    const request = run().catch((error) => {
        // 失败的请求不缓存，下次重新发
        cache.delete(key);
        throw error;
    });
    cache.set(key, request);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value as string);
    return request;
}

export function clearPromptCache() {
    cache.clear();
}
