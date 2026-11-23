import { LuTextCursorInput } from "react-icons/lu";
import { BaseEditor, BaseRange } from "slate";
import { ReactEditor } from "slate-react";

export interface ToolTextSelectionEvent {
    preventTextSelection: boolean;
    editor: BaseEditor & ReactEditor;
    range : Range;
    slateRange : BaseRange;
    precedingRange : Range;
    followingRange : Range;
    selectionid : number;
}

export class ToolbarTool {
    name : string;

    constructor(name : string) {
        this.name = name;
    }

    getMarksClassname() : string {
        return "textSelection" // Marks will use this class
    }

    getIcon() : React.ReactElement {
        return <LuTextCursorInput />
    }

    getIconHotspot() : {x: number, y: number} {
        return {x: 0, y: 0};
    }

    isIconAsCursor() : boolean {
        return true;
    }

    isEqual(tool: ToolbarTool) : boolean {
        return tool.name === this.name;
    }

    onTextSelected(event : ToolTextSelectionEvent) {
        /* Do nothing by default */
        return;
    }

    // 正文以汉字为主时能否使用，按英文语法改写的工具返回 false
    supportsMostlyHanText() : boolean {
        return true;
    }

    isSelectionOpaque() : boolean {
        return false; // By default, the selection is overlaid on top of the text, but for some effects, we might want it to be opaque
    }
}