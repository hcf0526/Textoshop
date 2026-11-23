// Textoshop 登录服务与静态文件托管，仅使用 Node 内置模块。
//
// 运行      node server/index.mjs
// 生成哈希  printf '%s' '<密码>' | node server/index.mjs hash <用户名>
//
// 环境变量
//   PORT        监听端口，默认 8080
//   STATIC_DIR  前端构建产物目录，默认 ./dist
//   DATA_DIR    数据目录，默认 ./data，内含 users.json 与 secret
//
// users.json 格式 {"users":[{"username":"...","salt":"...","hash":"..."}]}，只存 scrypt 哈希。
// docs/<账号>/<id>.json 为各账号的文档，互相隔离。
// settings.json 由服务自动维护，保存每个用户的大模型配置，API Key 用 AES-256-GCM 加密，只用于转发，不下发给浏览器。
// secret 为会话签名密钥，内容为任意随机字符串。不提供注册功能，账号只能在服务器上维护。

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const scryptAsync = promisify(scrypt);
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password, saltHex = randomBytes(16).toString('hex')) {
    const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, SCRYPT_OPTS);
    return { salt: saltHex, hash: key.toString('hex') };
}

// 命令行模式，从 stdin 读取密码，输出一条 users.json 记录
if (process.argv[2] === 'hash') {
    const username = process.argv[3];
    if (!username) {
        console.error('用法 printf "%s" "<密码>" | node server/index.mjs hash <用户名>');
        process.exit(1);
    }
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const password = Buffer.concat(chunks).toString('utf8');
    if (!password) {
        console.error('stdin 里没有密码');
        process.exit(1);
    }
    console.log(JSON.stringify({ username, ...(await hashPassword(password)) }));
    process.exit(0);
}

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = resolve(process.env.STATIC_DIR || 'dist');
const DATA_DIR = resolve(process.env.DATA_DIR || 'data');

const COOKIE = 'textoshop_session';
const SESSION_SECONDS = 7 * 24 * 3600;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const secret = readFileSync(join(DATA_DIR, 'secret'), 'utf8').trim();
if (secret.length < 32) throw new Error('secret 长度至少 32 个字符');

// 每个用户的大模型配置，{"用户名":{"baseURL":"...","model":"...","apiKey":"密文"}}
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const settingsKey = createHmac('sha256', secret).update('textoshop-settings').digest();

function encrypt(text) {
    if (!text) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', settingsKey, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

function decrypt(blob) {
    if (!blob) return '';
    try {
        const [iv, tag, data] = blob.split('.').map((x) => Buffer.from(x, 'base64url'));
        const decipher = createDecipheriv('aes-256-gcm', settingsKey, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
}

function loadSettings() {
    try {
        return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') return {};
        throw e;
    }
}
const settings = loadSettings();

function saveSettings() {
    // 写临时文件后改名，避免写到一半时文件损坏
    const tmp = `${SETTINGS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 1), { mode: 0o600 });
    renameSync(tmp, SETTINGS_FILE);
}

const SETTING_LIMITS = { baseURL: 500, apiKey: 500, model: 200 }; // apiKey 为空表示保留原值
const DEFAULT_TIMEOUT = 120;

// Base URL 只有域名时补上 /v1，与前端 normalizeBaseURL 一致
function normalizeBaseURL(value) {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
        const url = new URL(trimmed);
        if (url.pathname === '' || url.pathname === '/') return trimmed + '/v1';
    } catch {
        /* 无法解析时原样返回 */
    }
    return trimmed;
}
const TIMEOUT_RANGE = [5, 600];

function loadUsers() {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'users.json'), 'utf8'));
    return new Map(data.users.map((u) => [u.username, u]));
}
let users = loadUsers();
// 收到 SIGHUP 时重新读取账号文件，改密码后无需重启
process.on('SIGHUP', () => {
    try {
        users = loadUsers();
        console.log(`已重新加载 ${users.size} 个账号`);
    } catch (e) {
        console.error('账号文件读取失败', e.message);
    }
});

// 用户名未知时也跑一次 scrypt，避免通过响应时间判断用户是否存在
const dummy = await hashPassword(randomBytes(16).toString('hex'));

async function verify(username, password) {
    const user = users.get(username);
    const record = user ?? dummy;
    const { hash } = await hashPassword(password, record.salt);
    const ok = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.hash, 'hex'));
    return ok && user !== undefined;
}

// 会话令牌 = base64url(载荷) + "." + HMAC，载荷含用户名与过期时间
function sign(payload) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken(username) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

function readToken(token) {
    if (!token) return null;
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
        const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof u !== 'string' || typeof exp !== 'number' || exp < Date.now() / 1000) return null;
        return users.has(u) ? u : null; // 账号被删除后旧会话立即失效
    } catch {
        return null;
    }
}

function parseCookies(header = '') {
    const out = {};
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function sessionCookie(value, maxAge) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// 登录失败计数，按客户端 IP 统计
const failures = new Map();

function clientIp(req) {
    // 服务只监听本机端口，前面的 nginx 会写入真实 IP
    return req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
}

function isLocked(ip) {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.first > FAIL_WINDOW_MS) {
        failures.delete(ip);
        return false;
    }
    return f.count >= MAX_FAILS;
}

function recordFailure(ip) {
    const f = failures.get(ip);
    if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
    else f.count += 1;
}

setInterval(() => {
    for (const [ip, f] of failures) if (Date.now() - f.first > FAIL_WINDOW_MS) failures.delete(ip);
}, FAIL_WINDOW_MS).unref();

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, body, extraHeaders = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
    });
    res.end(data);
}

function readBody(req, limit = 4096) {
    return new Promise((resolveBody, reject) => {
        let size = 0;
        const chunks = [];
        let tooLarge = false;
        req.on('data', (c) => {
            if (tooLarge) return;
            size += c.length;
            if (size > limit) {
                // 超出上限时丢弃剩余内容，连接保留，调用方可以回复 413
                tooLarge = true;
                chunks.length = 0;
                reject(new Error('too large'));
            } else chunks.push(c);
        });
        req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function handleApi(req, res, path) {
    if (path === '/api/me' && req.method === 'GET') {
        const user = readToken(parseCookies(req.headers.cookie)[COOKIE]);
        return user ? sendJson(res, 200, { user }) : sendJson(res, 401, { error: 'unauthorized' });
    }

    if (path === '/api/login' && req.method === 'POST') {
        const ip = clientIp(req);
        if (isLocked(ip)) return sendJson(res, 429, { error: 'too_many_attempts' });
        let body;
        try {
            body = JSON.parse(await readBody(req));
        } catch {
            return sendJson(res, 400, { error: 'bad_request' });
        }
        const { username, password } = body ?? {};
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
            return sendJson(res, 400, { error: 'bad_request' });
        }
        if (!(await verify(username, password))) {
            recordFailure(ip);
            console.log(`登录失败 ${ip} ${JSON.stringify(username)}`);
            return sendJson(res, 401, { error: 'invalid_credentials' });
        }
        failures.delete(ip);
        console.log(`登录成功 ${ip} ${username}`);
        return sendJson(res, 200, { user: username }, { 'Set-Cookie': sessionCookie(issueToken(username), SESSION_SECONDS) });
    }

    if (path === '/api/settings') {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        if (req.method === 'GET') return sendJson(res, 200, publicSettings(settings[user]));
        if (req.method === 'PUT') {
            let body;
            try {
                body = JSON.parse(await readBody(req));
            } catch {
                return sendJson(res, 400, { error: 'bad_request' });
            }
            const next = {};
            for (const [k, max] of Object.entries(SETTING_LIMITS)) {
                const v = body?.[k] ?? '';
                if (typeof v !== 'string' || v.length > max) return sendJson(res, 400, { error: 'bad_request' });
                next[k] = v.trim();
            }
            if (next.baseURL && !/^https?:\/\//i.test(next.baseURL)) return sendJson(res, 400, { error: 'bad_base_url' });
            next.baseURL = normalizeBaseURL(next.baseURL);
            const timeout = body?.timeout ?? DEFAULT_TIMEOUT;
            if (!Number.isInteger(timeout) || timeout < TIMEOUT_RANGE[0] || timeout > TIMEOUT_RANGE[1]) {
                return sendJson(res, 400, { error: 'bad_timeout' });
            }
            const prev = settings[user];
            settings[user] = {
                baseURL: next.baseURL,
                model: next.model,
                // 没有传新 Key 时保留原来的
                apiKey: next.apiKey ? encrypt(next.apiKey) : (prev?.apiKey ?? ''),
                timeout,
                disableThinking: body?.disableThinking === true,
            };
            saveSettings();
            return sendJson(res, 200, publicSettings(settings[user]));
        }
        return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    // 大模型请求转发，浏览器发到 /api/llm/v1/...，服务端带上账号保存的 Key 发给模型服务
    if (path.startsWith(PROXY_PREFIX)) return proxyLLM(req, res, path.slice(PROXY_PREFIX.length));

    if (path === '/api/docs' || path.startsWith('/api/docs/')) {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        return handleDocs(req, res, path, user);
    }

    if (path === '/api/logout' && req.method === 'POST') {
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    return sendJson(res, 404, { error: 'not_found' });
}

// 文档存储，每个账号一个目录 DATA_DIR/docs/<账号>，每篇文档一个 JSON 文件
// 文件内容 {id, title, createdAt, updatedAt, content}，content 为前端序列化的编辑器状态，服务端不解析
const DOCS_DIR = join(DATA_DIR, 'docs');
const DOC_LIMIT = 200;
const DOC_BODY_LIMIT = 2 * 1024 * 1024;
const DOC_ID = /^[a-f0-9]{16}$/;

function userDocsDir(user) {
    // 账号名只含安全字符时直接用作目录名，否则转成十六进制
    const name = /^[A-Za-z0-9_.-]{1,64}$/.test(user) && !user.startsWith('.') ? user : Buffer.from(user).toString('hex');
    const dir = join(DOCS_DIR, name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function readDoc(user, id) {
    if (!DOC_ID.test(id)) return null;
    try {
        return JSON.parse(readFileSync(join(userDocsDir(user), `${id}.json`), 'utf8'));
    } catch {
        return null;
    }
}

function writeDoc(user, doc) {
    const file = join(userDocsDir(user), `${doc.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(doc), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
}

function listDocs(user) {
    const dir = userDocsDir(user);
    const docs = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
            const d = JSON.parse(readFileSync(join(dir, name), 'utf8'));
            docs.push({ id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt });
        } catch {
            /* 损坏的文件跳过 */
        }
    }
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

function cleanTitle(title) {
    return typeof title === 'string' ? title.trim().slice(0, 100) : '';
}

async function handleDocs(req, res, path, user) {
    const id = path.slice('/api/docs'.length).replace(/^\//, '');

    if (!id) {
        if (req.method === 'GET') return sendJson(res, 200, { docs: listDocs(user) });
        if (req.method === 'POST') {
            if (listDocs(user).length >= DOC_LIMIT) return sendJson(res, 400, { error: 'too_many_docs' });
            let body;
            try {
                body = JSON.parse(await readBody(req, DOC_BODY_LIMIT));
            } catch {
                return sendJson(res, 400, { error: 'bad_request' });
            }
            const now = Date.now();
            const doc = { id: randomBytes(8).toString('hex'), title: cleanTitle(body?.title) || 'Untitled', createdAt: now, updatedAt: now, content: body?.content ?? null };
            writeDoc(user, doc);
            return sendJson(res, 200, doc);
        }
        return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    const doc = readDoc(user, id);
    if (!doc) return sendJson(res, 404, { error: 'not_found' });
    if (req.method === 'GET') return sendJson(res, 200, doc);
    if (req.method === 'PUT') {
        let body;
        try {
            body = JSON.parse(await readBody(req, DOC_BODY_LIMIT));
        } catch (e) {
            return sendJson(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'too_large' : 'bad_request' });
        }
        if (body?.title !== undefined) doc.title = cleanTitle(body.title) || doc.title;
        if (body?.content !== undefined) doc.content = body.content;
        doc.updatedAt = Date.now();
        writeDoc(user, doc);
        return sendJson(res, 200, { id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt });
    }
    if (req.method === 'DELETE') {
        unlinkSync(join(userDocsDir(user), `${id}.json`));
        return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
}

// 返回给浏览器的配置，不含 API Key 明文
function publicSettings(s) {
    if (!s) return { saved: false, baseURL: '', model: '', timeout: DEFAULT_TIMEOUT, disableThinking: false, apiKeySet: false, apiKeyHint: '' };
    const key = decrypt(s.apiKey);
    return {
        saved: true,
        baseURL: normalizeBaseURL(s.baseURL),
        model: s.model,
        timeout: s.timeout ?? DEFAULT_TIMEOUT,
        disableThinking: !!s.disableThinking,
        apiKeySet: key.length > 0,
        apiKeyHint: key.length >= 8 ? key.slice(-4) : '',
    };
}

function currentUser(req) {
    return readToken(parseCookies(req.headers.cookie)[COOKIE]);
}

const PROXY_PREFIX = '/api/llm/v1';
const PROXY_PATHS = { '/chat/completions': 'POST', '/models': 'GET' };
const PROXY_BODY_LIMIT = 2 * 1024 * 1024;
const PROXY_MAX_MS = 10 * 60 * 1000;
const DEFAULT_UPSTREAM = 'https://api.openai.com/v1';

// 错误按 OpenAI 的格式返回，前端 SDK 能读出 message
function proxyError(res, status, message) {
    return sendJson(res, status, { error: { message, type: 'proxy_error' } });
}

// 禁止转发到本机与内网地址
function isPrivateHost(hostname) {
    const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true;
    if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function proxyLLM(req, res, subPath) {
    const user = currentUser(req);
    if (!user) return proxyError(res, 401, 'Not signed in');
    const method = PROXY_PATHS[subPath];
    if (!method) return proxyError(res, 404, 'Unsupported endpoint');
    if (req.method !== method) return proxyError(res, 405, 'Method not allowed');

    const s = settings[user];
    const base = normalizeBaseURL(s?.baseURL ?? '') || DEFAULT_UPSTREAM;
    const key = decrypt(s?.apiKey ?? '');
    let target;
    try {
        target = new URL(base + subPath);
    } catch {
        return proxyError(res, 400, 'Invalid Base URL');
    }
    const privateAllowed = process.env.PROXY_ALLOW_PRIVATE === '1'; // 仅供本地测试
    if (!/^https?:$/.test(target.protocol) || (!privateAllowed && isPrivateHost(target.hostname))) return proxyError(res, 400, 'Base URL not allowed');

    let body;
    if (method === 'POST') {
        let json;
        try {
            json = JSON.parse(await readBody(req, PROXY_BODY_LIMIT));
        } catch {
            return proxyError(res, 400, 'Invalid request body');
        }
        if (s?.disableThinking) json.thinking = { type: 'disabled' };
        body = JSON.stringify(json);
    }

    // 浏览器断开或超过上限时中止上游请求
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_MAX_MS);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });

    const started = Date.now();
    let upstream;
    try {
        upstream = await fetch(target, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: req.headers.accept || 'application/json',
                ...(key ? { Authorization: `Bearer ${key}` } : {}),
            },
            body,
            signal: controller.signal,
        });
    } catch (e) {
        clearTimeout(timer);
        console.log(`转发失败 ${user} ${target.host} ${e.name}`);
        if (!res.headersSent && !res.destroyed) return proxyError(res, 502, `Upstream unreachable: ${e.cause?.code ?? e.name}`);
        return;
    }

    res.writeHead(upstream.status, {
        ...SECURITY_HEADERS,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
    });
    try {
        for await (const chunk of upstream.body ?? []) res.write(chunk);
    } catch {
        /* 中途断开 */
    } finally {
        clearTimeout(timer);
        res.end();
        console.log(`转发 ${user} ${target.host} ${upstream.status} ${Date.now() - started}ms`);
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

// 静态文件读入内存缓存，可压缩类型同时缓存 gzip 版本
const fileCache = new Map();

function loadFile(absPath) {
    let entry = fileCache.get(absPath);
    if (entry) return entry;
    const st = statSync(absPath, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return null;
    const ext = extname(absPath).toLowerCase();
    const raw = readFileSync(absPath);
    entry = {
        raw,
        gzip: COMPRESSIBLE.has(ext) && raw.length > 1024 ? gzipSync(raw) : null,
        type: MIME[ext] || 'application/octet-stream',
    };
    // 视频等大文件不进缓存
    if (raw.length < 8 * 1024 * 1024) fileCache.set(absPath, entry);
    return entry;
}

function serveStatic(req, res, path) {
    let rel;
    try {
        rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
    } catch {
        res.writeHead(400).end();
        return;
    }
    let abs = resolve(STATIC_DIR, rel);
    if (abs !== STATIC_DIR && !abs.startsWith(STATIC_DIR + sep)) {
        res.writeHead(403).end();
        return;
    }
    let file = rel ? loadFile(abs) : null;
    if (!file) {
        // 单页应用回落到 index.html
        abs = join(STATIC_DIR, 'index.html');
        file = loadFile(abs);
    }
    const isAsset = rel.startsWith('assets/');
    const useGzip = file.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = useGzip ? file.gzip : file.raw;
    res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': file.type,
        'Content-Length': body.length,
        'Cache-Control': isAsset ? 'public, max-age=2592000, immutable' : 'no-cache',
        ...(useGzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path.startsWith('/api/')) return await handleApi(req, res, path);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        serveStatic(req, res, path);
    } catch (e) {
        console.error(e);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
        else res.end();
    }
});

server.listen(PORT, () => console.log(`Textoshop 服务已启动，端口 ${PORT}，账号 ${users.size} 个`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
