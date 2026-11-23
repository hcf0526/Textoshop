import { clearCache, prepare, walkLineRanges } from '@chenglou/pretext';

// 字数统计与拖动长度测量
// 计数单位：英文等按单词，中文按汉字，混排时两者相加
// 拖动测量：用 Pretext 按浏览器的断行规则模拟排版，找出鼠标位置对应的字数

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const HAN = /\p{Script=Han}/u;
const HAN_GLOBAL = /\p{Script=Han}/gu;

// 网络字体加载完成后清掉旧的测量缓存，之前量到的是回退字体的宽度
if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => clearCache());
    document.fonts.addEventListener?.('loadingdone', () => clearCache());
}

export function countUnits(text: string): number {
    return tokenize(text).tokens.length;
}

// 以汉字为主的文本用「字」，其余用「词」
export function isMostlyHan(text: string): boolean {
    const han = (text.match(HAN_GLOBAL) || []).length;
    return han > 0 && han >= countUnits(text) / 2;
}

export interface Tokenized {
    head: string      // 第一个单位之前的空白与标点
    tokens: string[]  // 每个单位连同其后的空白与标点
}

// 把文本切成计数单位，拼起来与原文完全一致
export function tokenize(text: string): Tokenized {
    let head = '';
    const tokens: string[] = [];
    for (const s of segmenter.segment(text)) {
        if (s.isWordLike) {
            if (HAN.test(s.segment)) {
                // 汉字逐个成为一个单位，夹在其中的字母数字连成一个单位
                let inRun = false;
                for (const ch of s.segment) {
                    if (HAN.test(ch)) {
                        tokens.push(ch);
                        inRun = false;
                    } else if (inRun) {
                        tokens[tokens.length - 1] += ch;
                    } else {
                        tokens.push(ch);
                        inRun = true;
                    }
                }
            } else if (tokens.length > 0 && /[A-Za-z0-9\u00C0-\u024F][-\u2010\u2011]$/.test(tokens[tokens.length - 1])) {
                // 连字符连起来的词算一个，如 well-known
                tokens[tokens.length - 1] += s.segment;
            } else {
                tokens.push(s.segment);
            }
        } else if (tokens.length === 0) {
            head += s.segment;
        } else {
            tokens[tokens.length - 1] += s.segment;
        }
    }
    return { head, tokens };
}

// 取前 n 个单位的文字
export function prefixUnits(t: Tokenized, n: number): string {
    return t.head + t.tokens.slice(0, n).join('');
}

// 拉长时的填充文字，循环使用选区自己的词，使平均词长与原文一致
export function fillerText(t: Tokenized, n: number): string {
    if (n <= 0 || t.tokens.length === 0) return '';
    const words = t.tokens.map(tok => {
        const word = tok.trimEnd();
        return HAN.test(word) ? word : word + ' ';
    });
    let out = '';
    for (let i = 0; i < n; i++) out += words[i % words.length];
    return out;
}

// 选区末尾与填充文字之间的分隔
export function fillerJoiner(selection: string): string {
    return /\s$/.test(selection) || isMostlyHan(selection) ? '' : ' ';
}

// 选区变为 n 个单位时的文字，n 超出原有单位数时补填充文字
export function textWithUnits(selection: string, t: Tokenized, n: number): string {
    if (n <= t.tokens.length) return prefixUnits(t, n);
    return selection + fillerJoiner(selection) + fillerText(t, n - t.tokens.length);
}

interface EndPosition { line: number, x: number }

function endPosition(text: string, font: string, maxWidth: number): EndPosition {
    const prepared = prepare(text.trimEnd(), font, { whiteSpace: 'pre-wrap' });
    let line = -1;
    let x = 0;
    walkLineRanges(prepared, maxWidth, (range) => {
        line += 1;
        x = range.width;
    });
    return { line: Math.max(line, 0), x };
}

function isBefore(a: EndPosition, b: EndPosition): boolean {
    return a.line < b.line || (a.line === b.line && a.x <= b.x);
}

export interface MeasureParams {
    before: string        // 同一段落里选区之前的文字
    selection: string     // 选区文字
    font: string          // 画布字体，与页面一致
    maxWidth: number      // 段落内容宽度
    pointerLine: number   // 鼠标所在行，从 0 开始
    pointerX: number      // 鼠标相对段落左边界的横坐标
    maxExtra?: number     // 最多拉长的单位数
}

// 找出鼠标位置对应的单位数，至少为 1
export function measureTargetUnits(p: MeasureParams): number {
    const t = tokenize(p.selection);
    const total = t.tokens.length;
    const maxN = total + (p.maxExtra ?? 300);
    const pointer = { line: p.pointerLine, x: p.pointerX };
    const pos = (n: number) => endPosition(p.before + textWithUnits(p.selection, t, n), p.font, p.maxWidth);

    // 二分查找末尾仍在鼠标之前的最大单位数
    let lo = 1, hi = maxN, best = 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (isBefore(pos(mid), pointer)) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    // 鼠标越过下一个单位的一半时算上它
    if (best < maxN) {
        const cur = pos(best);
        const next = pos(best + 1);
        if (next.line === cur.line && next.line === pointer.line && pointer.x >= (cur.x + next.x) / 2) best += 1;
    }
    return best;
}

// 选区边界落在中文词内部时，求该词的边界，用于拖选时按词吸附
// 只在连续的汉字之间移动，遇到标点、空白、字母与数字即停
// side 为 'start' 时向前找词首，为 'end' 时向后找词尾，返回新的偏移
export function hanWordBoundary(text: string, offset: number, side: 'start' | 'end'): number {
    if (offset <= 0 || offset >= text.length) return offset;
    if (!HAN.test(text[offset - 1]) || !HAN.test(text[offset])) return offset;

    // 偏移两侧的整段连续汉字
    let runStart = offset - 1;
    while (runStart > 0 && HAN.test(text[runStart - 1])) runStart--;
    let runEnd = offset + 1;
    while (runEnd < text.length && HAN.test(text[runEnd])) runEnd++;

    const local = offset - runStart;
    for (const s of segmenter.segment(text.slice(runStart, runEnd))) {
        const segEnd = s.index + s.segment.length;
        if (s.index < local && local < segEnd) {
            return runStart + (side === 'start' ? s.index : segEnd);
        }
    }
    return offset;
}
