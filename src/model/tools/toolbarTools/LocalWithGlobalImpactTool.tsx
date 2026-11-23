import { Editor } from "slate";
import { runJob, startJob } from "../../PendingEdits";
import { ReactEditor } from "slate-react";
import { RangeUtils } from "../../../view/components/TextSelection";
import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";

export class LocalWithGlobalImpactTool extends ToolbarTool {
    constructor(name: string) {
        super(name);
    }

    getMarksClassname() : string {
        return "genericSelection" // Marks will use this class
    }

    executeLocalWithGlobalImpactModification(startText: string, text: string, endText: string): Promise<string> {
        return Promise.resolve("");
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const text = event.range.toString()
        const sentenceRange = RangeUtils.getRangeSnappedToSentence(event.range);

        const sentenceSlateRange = ReactEditor.toSlateRange(event.editor, sentenceRange, { exactMatch: true, suppressThrow: true});

        if (text.length > 1 && sentenceSlateRange) {
            const startRange = { anchor: sentenceSlateRange.anchor, focus: event.slateRange.anchor };
            const endRange = { anchor: event.slateRange.focus, focus: sentenceSlateRange.focus };

            const startText = Editor.string(event.editor, startRange);
            const endText = Editor.string(event.editor, endRange);

            if (text.length > 1) {
                // 标记整句，结果写回这一句，等待期间可以点别处或改写其他文字
                event.preventTextSelection = true;
                const job = startJob(event.editor, sentenceSlateRange, this.getMarksClassname());
                runJob(job, this.executeLocalWithGlobalImpactModification(startText, text, endText), this.name);
              }
        }
    }
}