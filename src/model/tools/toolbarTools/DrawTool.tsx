import { FaPaintBrush } from "react-icons/fa";
import { useModelStore } from "../../Model";
import { runJob, startJob } from "../../PendingEdits";
import { TextToneChanger } from "../promptTools/TextToneChanger";
import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";


export class DrawTool extends ToolbarTool {
    constructor() {
        super(DrawTool.getToolName());
    }

    getMarksClassname() : string {
        return "brush";
    }

    getIcon() : React.ReactElement {
        return <FaPaintBrush />
    }

    getIconHotspot(): { x: number; y: number; } {
        return { x: 2, y: 14 };
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const tone = useModelStore.getState().tone;
        const text = event.range.toString()

        const startingTone =  [
            { lowAdjective: "Informal", highAdjective: "Formal", value: 5 },
            { lowAdjective: "Impolite", highAdjective: "Polite", value: 5 },
            { lowAdjective: "Complicated", highAdjective: "Simple", value: 5 },
        ];

        if (text.length > 1) {
            // 结果写回发请求时标记的原文，等待期间可以点别处或改写其他文字
            event.preventTextSelection = true;
            const job = startJob(event.editor, event.slateRange, this.getMarksClassname());
            runJob(job, new TextToneChanger(text, startingTone).execute(tone), DrawTool.getToolName());
          }
    }

    static getToolName() : string {
        return "Tone Brush";
    }
}