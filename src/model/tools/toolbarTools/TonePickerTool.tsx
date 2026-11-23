import { FaEyeDropper } from "react-icons/fa6";
import { completeJob, failJob, startJob } from "../../PendingEdits";
import { useStudyStore } from "../../../study/StudyModel";
import { useModelStore } from "../../Model";
import { useUndoModelStore } from "../../UndoModel";
import { TextTonePicker } from "../promptTools/TextTonePicker";
import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";


export class TonePickerTool extends ToolbarTool {
    constructor() {
        super(TonePickerTool.getToolName());
    }

    getMarksClassname() : string {
        return "genericSelection";
    }

    getIcon() : React.ReactElement {
        return <FaEyeDropper />
    }

    getIconHotspot(): { x: number; y: number; } {
        return { x: 2, y: 14 };
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const tone = useModelStore.getState().tone;
        const text = event.range.toString()

        if (text.length > 1) {
            // 吸取语气不改动文字，标记只用于显示闪烁与计时
            event.preventTextSelection = true;
            const job = startJob(event.editor, event.slateRange, this.getMarksClassname());
            new TextTonePicker(text).execute(tone).then(result => {
                useUndoModelStore.getState().storeUndoState(TonePickerTool.getToolName());
                useStudyStore.getState().logEvent("TONE_CHANGED", {source: "eyedropper", tone: tone});
                useModelStore.getState().setTone(result);
                completeJob(job);
            }, (error) => {
                console.error(error);
                failJob(job);
            });
        }
    }

    static getToolName() : string {
        return "Tone Picker";
    }
}