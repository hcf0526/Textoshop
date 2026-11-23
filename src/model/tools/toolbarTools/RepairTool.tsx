import React from "react";
import { runJob, startJob } from "../../PendingEdits";
import { MdHealing } from "react-icons/md";
import { TextRepair } from "../promptTools/TextRepair";
import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";

export class RepairTool extends ToolbarTool {
    constructor() {
        super(RepairTool.getToolName());
    }

    getMarksClassname() : string {
        return "genericSelection" // Marks will use this class
    }

    getIcon() : React.ReactElement {
        return <MdHealing />
    }

    getIconHotspot(): { x: number; y: number; } {
        return { x: 8, y: 8 };
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const text = event.range.toString()

        if (text.length > 1) {
            // 结果写回发请求时标记的原文，等待期间可以点别处或改写其他文字
            event.preventTextSelection = true;
            const job = startJob(event.editor, event.slateRange, this.getMarksClassname());
            runJob(job, new TextRepair(text).execute(), RepairTool.getToolName());
          }
    }

    static getToolName() : string {
        return "Repair / Fix Grammar";
    }


}