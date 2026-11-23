import React from "react";
import { runJob, startJobForSelection } from "../../PendingEdits";
import { RiInputCursorMove } from "react-icons/ri";
import { useModelStore } from "../../Model";
import { useViewModelStore } from "../../ViewModel";
import { TextPrompter } from "../promptTools/TextPrompter";
import { ToolTextSelectionEvent, ToolbarTool } from "./ToolbarTool";


export class PrompterTool extends ToolbarTool {
    constructor() {
        super(PrompterTool.getToolName());
    }

    getMarksClassname() : string {
        return "textSelection" // Marks will use this class
    }

    getIcon() : React.ReactElement {
        return <RiInputCursorMove />
    }
    
    getIconHotspot(): { x: number; y: number; } {
        return { x: 8, y: 8 };
    }

    onTextSelected(event: ToolTextSelectionEvent): void {
        const selectedText = event.range.toString();
        const precedingText = event.precedingRange.toString();
        const followingText = event.followingRange.toString();

        useViewModelStore.getState().setPromptBoxValidatedCallback((prompt: string) => {
            // 把选区换成改写任务标记，随后清掉选区，结果写回原文
            const job = startJobForSelection(event.selectionid, this.getMarksClassname());
            useModelStore.getState().setSelectedTexts([]);
            runJob(job, new TextPrompter(selectedText, precedingText, followingText).execute(prompt), PrompterTool.getToolName());
        });
        useViewModelStore.getState().openPromptBox();
    }

    static getToolName() : string {
        return "Prompt";
    }


}