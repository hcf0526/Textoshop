import { useStudyStore } from "../../../study/StudyModel";
import { resolveModel } from "../../LLMConfig";
import { useModelStore } from "../../Model";
import { countUnits, isMostlyHan } from "../../utils/LengthMeasure";
import { PromptParserUtils } from "../../utils/PromptParserUtils";
import { TextUtils } from "../../utils/TextUtils";
import { PromptTool } from "./PromptTool";

// 调整长度。参数与缓存键均为字数（英文按词、中文按字，见 LengthMeasure.countUnits）
// 每次只发 1 个请求，让模型一次给出略短、正好、略长 3 个版本，本地精确计数后取最接近的
// 拿到的每个版本都按字数缓存，之后拖到容差内的字数直接取缓存

const RELATIVE_TOLERANCE = 0.05;

// 容差为 1 个单位与目标的 5% 中较大者
export function resizeTolerance(target: number): number {
    return Math.max(1, Math.round(target * RELATIVE_TOLERANCE));
}

function unitName(text: string): string {
    return isMostlyHan(text) ? 'Chinese characters' : 'words';
}

function parseVersions(raw: string): string[] {
    try {
        const parsed = PromptParserUtils.parseJSON(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed?.versions ?? (parsed?.text ? [parsed.text] : []));
        return list.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0);
    } catch (e) {
        console.error("Error while parsing JSON", e);
        return [];
    }
}

export class TextResizer extends PromptTool<string, number, string> {
    constructor(originalText: string) {
        super(originalText);
        this.cache.set(""+countUnits(originalText), originalText);
    }

    // 缓存里字数在容差内的版本中取最接近的
    private closestCached(target: number): string | null {
        let best: string | null = null;
        let bestDiff = Infinity;
        for (const [key, value] of this.cache) {
            const diff = Math.abs(Number(key) - target);
            if (diff < bestDiff) {
                best = value;
                bestDiff = diff;
            }
        }
        return best !== null && bestDiff <= resizeTolerance(target) ? best : null;
    }

    cachedExecute(targetUnits: number): Promise<string> {
        const cached = this.closestCached(targetUnits);
        if (cached !== null) return Promise.resolve(cached);
        return this.execute(targetUnits);
    }

    private remember(versions: string[]) {
        for (const v of versions) {
            const key = "" + countUnits(v);
            if (!this.cache.has(key)) this.cache.set(key, v);
        }
    }

    private request(prompt: string): Promise<string[]> {
        return useModelStore.getState().executePrompt({
            model: resolveModel('gpt-4o-mini-2024-07-18'),
            prompt,
            json: true,
        }).then(result => parseVersions(result.result).map(v => TextUtils.getFittingString(v, this.input)));
    }

    async execute(targetUnits: number): Promise<string> {
        useStudyStore.getState().logEvent("PROMPT_TOOL_EXECUTED", { className: this.constructor.name, input: this.input, parameters: targetUnits });
        if (targetUnits <= 0) return "";

        const current = countUnits(this.input);
        if (targetUnits === current) return this.input;

        const unit = unitName(this.input);
        const delta = resizeTolerance(targetUnits);
        const targets = [Math.max(1, targetUnits - delta), targetUnits, targetUnits + delta];
        const how = targetUnits < current
            ? "Remove only what is least important. Keep the meaning, tone, tense, point of view and style."
            : "Add only details consistent with the text. Keep the meaning, tone, tense, point of view and style.";
        // 模型对增删多少个词比对总字数更敏感，每个版本写明增删数量
        const step = (n: number) => `${n > current ? `add ${n - current}` : `remove ${current - n}`} ${unit} (result: ${n} ${unit})`;

        const prompt = `Text (${current} ${unit}):
${this.input}

Write three versions of this text:
1. ${step(targets[0])}
2. ${step(targets[1])}
3. ${step(targets[2])}
${how}
Keep the same language as the original text.
Respond with a JSON object with the property "versions", an array of the three rewritten texts in that order, without any comments.`;

        const versions = await this.request(prompt);
        if (versions.length === 0) throw new Error("No version returned");
        this.remember(versions);

        // 只发这 1 个请求，在返回的版本里取字数最接近的
        return versions.reduce((a, b) =>
            Math.abs(countUnits(b) - targetUnits) < Math.abs(countUnits(a) - targetUnits) ? b : a);
    }
}

