import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";
import { runJob, startJob } from "../../PendingEdits";
import { BsFillHandIndexThumbFill } from "react-icons/bs";
import React from "react";
import { TextSmudger } from "../promptTools/TextSmudger";

export class SmudgeTool extends ToolbarTool {
    constructor() {
        super(SmudgeTool.getToolName());
    }

    getMarksClassname() : string {
        return "smudge" // Marks will use this class
    }

    getIcon() : React.ReactElement {
        return <BsFillHandIndexThumbFill />
    }

    getIconHotspot(): { x: number; y: number; } {
        return { x: 6, y: 0 };
    }

    isSelectionOpaque(): boolean {
        return true;
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const text = event.range.toString()

        if (text.length > 1) {
            // 结果写回发请求时标记的原文，等待期间可以点别处或改写其他文字
            event.preventTextSelection = true;
            const job = startJob(event.editor, event.slateRange, this.getMarksClassname());
            runJob(job, new TextSmudger(text).execute(), SmudgeTool.getToolName());
          }
    }

    static getToolName() : string {
        return "Smudge";
    }


}