import { Button, Divider, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Kbd, Tooltip } from "@nextui-org/react";
import { useTopOffset } from '../ChromeModel';
import { useEffect } from "react";
import { IoIosArrowDown, IoIosUndo, IoMdCheckmark } from "react-icons/io";
import { tools, useModelStore } from "../../model/Model";
import { ToolbarTool } from "../../model/tools/toolbarTools/ToolbarTool";
import { useUndoModelStore } from "../../model/UndoModel";
import { useT } from "../../i18n";
import { Node } from "slate";
import { isMostlyHan } from "../../model/utils/LengthMeasure";
import { SelectionTool } from "../../model/tools/toolbarTools/SelectionTool";

// 正文是否以汉字为主，选择器返回布尔值，正文变化时只在结果改变后重渲染
// textFields 未变时沿用上次结果，免得每次状态更新都重新分词
let lastTextFields: unknown = null;
let lastMostlyHan = false;
function isMainTextMostlyHan(state: ReturnType<typeof useModelStore.getState>): boolean {
  if (state.textFields === lastTextFields) return lastMostlyHan;
  const mainTextField = state.textFields.find(textField => textField.id === "mainTextField");
  lastTextFields = state.textFields;
  lastMostlyHan = mainTextField ? isMostlyHan(mainTextField.state.map(node => Node.string(node)).join("\n")) : false;
  return lastMostlyHan;
}

function isToolAvailable(tool: ToolbarTool, mainTextMostlyHan: boolean): boolean {
  return !mainTextMostlyHan || tool.supportsMostlyHanText();
}

export function ToolbarButton(props: {tool: ToolbarTool, shortcutButton?: string, toolVariants: ToolbarTool[], mainTextMostlyHan?: boolean}) {
  const t = useT();
  const setSelectedTool = useModelStore(state => state.setSelectedTool);
  const selectedToolStr = useModelStore(state => state.selectedTool);
  const selectedTool = tools[selectedToolStr];

  const isSelected = selectedTool === props.tool;
  const mainTextMostlyHan = props.mainTextMostlyHan ?? false;
  const isDisabled = !isToolAvailable(props.tool, mainTextMostlyHan);

  const size = 32;

  return (<div style={{display: 'flex', flexDirection: 'row', marginBottom: 8}}>
    <div style={{width: 10}}>
    {props.toolVariants.length > 1  && <Dropdown>
    <DropdownTrigger>
      <Button isDisabled={isDisabled} isIconOnly size={"sm"} variant={"light"} style={{width: 10, minWidth: 10, height: size, minHeight: size}}>
        <IoIosArrowDown style={{width: 8}} />
      </Button>
    </DropdownTrigger>
    <DropdownMenu variant="flat" disabledKeys={props.toolVariants.filter(tool => !isToolAvailable(tool, mainTextMostlyHan)).map(tool => tool.name)}>
      {props.toolVariants.map((tool) => {
        return <DropdownItem textValue={t(tool.name)} key={tool.name} onClick={() => {
          // Change the order of the tools to place this tool as the first one
          const toolOrder = useModelStore.getState().toolsOrderInToolbar;
          const idx = toolOrder.findIndex((toolNames) => toolNames.includes(tool.name));
          const newToolOrder = [...toolOrder];
          newToolOrder[idx] = [tool.name, ...newToolOrder[idx].filter((toolName) => toolName !== tool.name)];
          useModelStore.getState().setToolOrderInToolbar(newToolOrder);
          useModelStore.getState().setSelectedTool(tool.name);
        }}>
          <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5}}>
          <div style={{width: 15}}>{props.tool.name === tool.name && <IoMdCheckmark/>}</div>
            <div style={{width: 15}}>{tool.getIcon()}</div>
            <span>{t(tool.name)}</span>
          </div>
          </DropdownItem>
      })}
    </DropdownMenu>
  </Dropdown>}
    </div>
      <Tooltip showArrow delay={0} closeDelay={0} content={isDisabled ? <span>{t('Not available for Chinese text')}</span> : <span>
      {t(props.tool.name)}
      <Kbd style={{marginLeft: 10}}>{props.shortcutButton}</Kbd>
    </span>} placement="right" offset={0}>
        {/* 停用的按钮不响应鼠标，外层容器负责触发提示 */}
        <div style={{display: 'flex'}}>
        <Button 
    isDisabled={isDisabled}
    isIconOnly
    size={"sm"}
    variant={"light"}
    style={{position: 'relative', width: size, height: size, minWidth: size, minHeight: size, fontSize: 18, color: isSelected ? "black" : '#71717B', background: isSelected ? '#D7E7FA' : undefined}}
    onClick={(e) => {
      setSelectedTool(props.tool.name);
    }}>
        {props.tool.getIcon()}
      </Button>
        </div>
    </Tooltip>
    <div style={{width: 10, height: size, display: 'flex', flexDirection: 'row', alignItems: 'end'}}>
      {props.shortcutButton && <span style={{fontSize: 10, marginLeft: 1, color: isSelected ? "black" : '#71717B'}}>{props.shortcutButton}</span>}
      </div>
  </div>)
}



export function Toolbar() {
  const t = useT();
  const setSelectedTool = useModelStore(state => state.setSelectedTool);
  const topOffset = useTopOffset();
  const undoStack = useUndoModelStore(state => state.undoStack);
  const redoStack = useUndoModelStore(state => state.redoStack);
  const toolsOrderInToolbar = useModelStore(state => state.toolsOrderInToolbar);
  const selectedToolName = useModelStore(state => state.selectedTool);
  const mainTextMostlyHan = useModelStore(isMainTextMostlyHan);

  const toolKeyShortcuts : string[] = [];


  const toolButtons = toolsOrderInToolbar.map((toolNames, idx) => {
    const tool = tools[toolNames[0]];
    toolKeyShortcuts.push(tool.name);
    const toolVariants = [...toolNames].sort().map((toolName) => tools[toolName]);

    return <ToolbarButton key={tool.name} tool={tool} shortcutButton={`${idx+1}`} toolVariants={toolVariants} mainTextMostlyHan={mainTextMostlyHan}/>
  });

  // 正文转为中文时，当前工具若已停用则换回选择工具
  useEffect(() => {
    const selectedTool = tools[selectedToolName];
    if (selectedTool && !isToolAvailable(selectedTool, mainTextMostlyHan)) {
      setSelectedTool(SelectionTool.getToolName());
    }
  }, [mainTextMostlyHan, selectedToolName]);


  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      // If we are currently in an input field, we don't want to trigger the shortcuts
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.getAttribute('contenteditable'))) return;

      // If no modifier keys are pressed
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // If the key pressed is a number
        if (e.key >= '1' && e.key <= toolKeyShortcuts.length.toString()[0]) {
          const idx = parseInt(e.key) - 1;
          // 快捷键同样跳过停用的工具
          if (idx < toolKeyShortcuts.length && isToolAvailable(tools[toolKeyShortcuts[idx]], isMainTextMostlyHan(useModelStore.getState()))) {
            setSelectedTool(toolKeyShortcuts[idx]);
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    }
  }, []);

  return (
    <div className='drop-shadow-md' style={{ position: 'absolute', left: 20, top: 20 + topOffset, padding: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 15, paddingTop: 15, background: 'white', borderRadius: 14 }}>
          {toolButtons}
          <Divider style={{marginBottom: 5}} />
          <Tooltip showArrow delay={0} closeDelay={0} content={t("Undo")} placement="right" offset={0}>
            <Button isDisabled={undoStack.length === 0} style={{color: '#71717a', fontSize: 16}} isIconOnly size={"sm"} variant={"light"} onClick={() => useUndoModelStore.getState().undo()}><IoIosUndo/></Button>
          </Tooltip>
          <Tooltip showArrow delay={0} closeDelay={0} content={t("Redo")} placement="right" offset={0}>
            <Button isDisabled={redoStack.length === 0} style={{color: '#71717a', fontSize: 16}} isIconOnly size={"sm"} variant={"light"} onClick={() => useUndoModelStore.getState().redo()}><IoIosUndo style={{transform: 'scaleX(-1)'}}/></Button>
          </Tooltip>
        </div>
  )
}
