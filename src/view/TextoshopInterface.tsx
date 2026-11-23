import EditableTextField from './components/EditableTextField';
import { useTopOffset } from './ChromeModel';
import { copySelection, cutSelection, pasteIntoSelection } from './../model/EditActions';
import { runJob, startJobForSelection } from './../model/PendingEdits';
import HistoryPanel from './components/HistoryPanel';

import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@nextui-org/react';
import { useEffect, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { CgArrowsBreakeH, CgArrowsMergeAltH } from 'react-icons/cg';
import { MdContentCopy, MdContentCut, MdContentPaste } from 'react-icons/md';
import { BaseRange, Editor, Node as SlateNode } from 'slate';
import { ReactEditor } from 'slate-react';
import { textFieldEditors, tools, useModelStore } from '../model/Model';
import { TextConsolidater } from '../model/tools/promptTools/TextConsolidater';
import { TextDistributer } from '../model/tools/promptTools/TextDistributer';
import { useUndoModelStore } from '../model/UndoModel';
import { DraggingParameters, useViewModelStore } from '../model/ViewModel';
import { useStudyStore } from '../study/StudyModel';
import DragnDrop from './components/DragnDrop';
import { LayerManager } from './components/LayerManager';
import { PromptBox } from './components/PromptBox';
import { TextMergerMenu } from './components/TextMergerMenu';
import { RangeUtils } from './components/TextSelection';
import { TonePicker } from './components/TonePicker';
import { Toolbar } from './components/Toolbar';
import { Utils } from './Utils';
import { useT } from '../i18n';


export default function TextoshopInterface(props: { children?: React.ReactNode }) {
  const t = useT();
  const selectedToolStr = useModelStore(state => state.selectedTool);
  const selectedTool = tools[selectedToolStr];
  const textFields = useModelStore(state => state.textFields);
  const selectedTexts = useModelStore(state => state.selectedTexts);
  const setSelectedTexts = useModelStore(state => state.setSelectedTexts);
  const sentenceHovered = useViewModelStore(state => state.sentenceHovered);
  const setSentenceHovered = useViewModelStore(state => state.setSentenceHovered);
  const [draggedElementId, setDraggedElementId] = useState<string>('');
  const [elementDroppedTimestamp, setElementDroppedTimestamp] = useState<number>(0);
  const [textMergerMenuPos, setTextMergerMenuPos] = useState<{ x: number, y: number } | null>(null);
  const [contextualMenuPosition, setContextualMenuPosition] = useState<{ x: number, y: number } | null>(null);

  useEffect(() => {
    // Install key up/listener
    const keyDownListener = (e: KeyboardEvent) => {

      if (e.key === "z" && (e.ctrlKey || (e.metaKey && !e.shiftKey))) {
        e.preventDefault();
        useUndoModelStore.getState().undo();
      }

      if ((e.key === "y" && e.ctrlKey) || (e.key === "z" && e.metaKey && e.shiftKey)) {
        e.preventDefault();
        useUndoModelStore.getState().redo();
      }

      if (e.key === "Escape") {
        setSelectedTexts([]);
      }
    }

    const keyUpListener = (e: KeyboardEvent) => {
      if (e.key === "Backspace" && selectedTexts.length === 0 && draggedElementId !== "" && document.activeElement === document.body) {
        useUndoModelStore.getState().storeUndoState('Delete text box');
        useModelStore.getState().removeTextField(draggedElementId);
        setDraggedElementId('');
      }
    }


    window.addEventListener('keyup', keyUpListener);
    window.addEventListener('keydown', keyDownListener);

    return () => {
      window.removeEventListener('keyup', keyUpListener);
      window.removeEventListener('keydown', keyDownListener);
    }
  });

  const updateHoveredSentence = (e: MouseEvent, force: boolean = false) => {
    // If the target is a span, figure out if we are over a text field and which text field
    if (e.target instanceof HTMLElement && (e.target.tagName === "SPAN" || e.target.hasAttribute("data-slate-node"))) {
      const textField = e.target.closest('.editableTextField');

      if (textField) {
        const isMoveable = textField.classList.contains('isMoveableTextField');
        const isDiv = false;//e.target.tagName === "DIV";
        const previousHoveredSentence = useViewModelStore.getState().sentenceHovered;

        let range: Range | null = null;
        let caretPosition: { offset: number, offsetNode: Node } | null = null;
        let sentenceRange: Range | null = null;
        let slateRange: BaseRange | null = null;


        const editor = textFieldEditors[textField.id];

        if (!isDiv) {
          caretPosition = Utils.caretPositionFromPoint(e.clientX, e.clientY)

          if (caretPosition) {
            // Stop early to avoid re-calculating everything if same caret
            if (!force && previousHoveredSentence && previousHoveredSentence.caretPosition && caretPosition.offsetNode.isSameNode(previousHoveredSentence.caretPosition.offsetNode) && caretPosition.offset === previousHoveredSentence.caretPosition.offset) {
              return;
            }

            range = document.createRange();
            range.setStart(caretPosition.offsetNode, caretPosition.offset > 0 ? caretPosition.offset - 1 : caretPosition.offset);
            range.setEnd(caretPosition.offsetNode, caretPosition.offset === 0 ? caretPosition.offset + 1 : caretPosition.offset);

            // Stop early if same range
            if (!force && previousHoveredSentence && previousHoveredSentence.cursorRange !== null && previousHoveredSentence.cursorRange.toString() === range.toString()) {
              return;
            }
          }
        }

        if (isMoveable) {
          // Special case where we are hovering a text fragment. In this case, the whole text fragment is selected
          const slateStartPoint = Editor.start(editor, []);
          const slateEndPoint = Editor.end(editor, []);
          slateRange = { anchor: slateStartPoint, focus: slateEndPoint };
          sentenceRange = ReactEditor.toDOMRange(editor, slateRange);
        } else if (range !== null) {
          // Otherwise, we figure out the sentence / chunk around the selection that would make the most sense
          sentenceRange = RangeUtils.getRangeSnappedToSentence(range);

          // Stop early if same sentenceRange
          if (!force && previousHoveredSentence && previousHoveredSentence.textfieldId === textField.id && previousHoveredSentence.range.toString() === sentenceRange.toString()) {
            useViewModelStore.getState().setSentenceHovered({ ...previousHoveredSentence, cursorRange: range, caretPosition: caretPosition }); // Just update the range
            return;
          }

          slateRange = ReactEditor.toSlateRange(editor, sentenceRange, { exactMatch: true, suppressThrow: true });

          if (slateRange === null) {
            // This might happen in case we are hovering a text selection. Check for this case and fix it by retrieving the slate range of the current selection
            const selectedText = e.target.closest('.selectedText');
            if (selectedText) {
              const nodes = Editor.nodes(editor, { at: [], mode: 'all', match: (n: any) => n.selectionId !== undefined });
              for (const [node, path] of nodes) {
                slateRange = { anchor: { path: path, offset: 0 }, focus: { path: path, offset: SlateNode.string(node).length } };
                break;
              }
            }
          }
        }

        if (sentenceRange && slateRange) {
          useViewModelStore.getState().setSentenceHovered({ cursorRange: range, slateRange: slateRange, caretPosition: caretPosition, range: sentenceRange, rects: [...sentenceRange.getClientRects()], textfieldId: textField.id, position: { x: e.clientX, y: e.clientY } });
          return;
        }
      }
    }
    setTextMergerMenuPos(null);
    setSentenceHovered(null);
  }

  const onTextFieldDragged = (e: MouseEvent) => {
    updateHoveredSentence(e);
  }

  const onTextFieldDraggingEnded = (e: MouseEvent, draggingParameters: DraggingParameters[]) => {
    const textFieldId = draggingParameters[0].elementId.startsWith("textField") ? draggingParameters[0].elementId : "textField" + draggingParameters[0].elementId;
    setDraggedElementId(textFieldId);
    setElementDroppedTimestamp(Date.now());
    setTextMergerMenuPos({ x: e.clientX, y: e.clientY });
  }

  const sentenceHoveredRects = sentenceHovered ? sentenceHovered.rects : [];
  const characterHoveredRects = (sentenceHovered && sentenceHovered.cursorRange !== null) ? [...sentenceHovered.cursorRange.getClientRects()] : [];


  let cursor = "auto";

  if (selectedTool.isIconAsCursor()) {
    const toolCursorSvg = renderToString(selectedTool.getIcon());
    cursor = `url("data:image/svg+xml,${encodeURI(toolCursorSvg)}") ${selectedTool.getIconHotspot().x} ${selectedTool.getIconHotspot().y}, auto`;
  }

  const disableTools = useStudyStore(state => state.disableTools);
  // 菜单栏显示时内容整体下移
  const topOffset = useTopOffset();
  const disableTonePicker = useStudyStore(state => state.disableTonePicker);
  const disableLayers = useStudyStore(state => state.disableLayers);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100vh', paddingTop: topOffset, background: '#F2EEF0' }}>
        <div id="background" style={{ position: 'relative', display: 'flex', justifyContent: 'center', flexGrow: 4, cursor: cursor }}
          onMouseDown={(e) => {
            // Deselect if we are clicking a div with id "background" or "mainTextField"
            if (e.target instanceof HTMLElement && (e.target.id === "background" || e.target.id === "mainTextField")) {
              setSelectedTexts([]);
            }
          }}

          onContextMenu={(e) => {
            e.preventDefault();
            setContextualMenuPosition({ x: e.clientX, y: e.clientY });
          }}
        >

          {props.children}
          <DragnDrop onDragging={onTextFieldDragged} onDraggingEnd={onTextFieldDraggingEnded} />
          {/* First text field is considered the main one and placed in the center. The others are placed in absolute coordinates */}
          {textFields.length > 0 &&
            <EditableTextField isMoveable={false} textField={textFields[0]} style={{ position: 'relative', background: 'white', width: 700, paddingTop: 60, marginTop: 20, paddingLeft: 50, paddingRight: 50, borderRadius: '2px', boxShadow: '0 0 10px rgba(0,0,0,0.1)', overflow: 'scroll' }} />
          }
          {textFields.length > 1 &&  textFields.slice(1).map((textField, index) => {
            return <EditableTextField isMoveable={true} textField={textField} key={index} style={{ display: textField.isVisible ? 'block' : 'none', zIndex: (sentenceHovered !== null && sentenceHovered.textfieldId === textField.id) ? 4 : 99 }} />
          })}
          {sentenceHoveredRects.map((rect, index) => {
            return <div key={index} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, background: 'rgba(0, 0, 0, 0.1)', pointerEvents: 'none', zIndex: 5 }}></div>
          })}

          {characterHoveredRects.map((rect, index) => {
            return <div key={index} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, background: 'rgba(255, 219, 88, 0.8)', pointerEvents: 'none', zIndex: 6 }}></div>
          })}

          <PromptBox />

          {(textMergerMenuPos !== null && sentenceHoveredRects.length > 0) && <Popover offset={20} isOpen={textMergerMenuPos !== null} showArrow={true}
            /* Wait at least 200ms after the drop before the menu can be closed */
            shouldCloseOnInteractOutside={(e) => (Date.now() - elementDroppedTimestamp) > 200}
            onClose={() => { setTextMergerMenuPos(null); setSentenceHovered(null) }}>
            <PopoverTrigger>
              <div style={{ position: 'absolute', zIndex: 99999, left: textMergerMenuPos.x, top: textMergerMenuPos.y }}></div>
            </PopoverTrigger>
            <PopoverContent>
              <TextMergerMenu draggedElementId={draggedElementId} />
            </PopoverContent>
          </Popover>}

          {contextualMenuPosition !== null && <Dropdown
            onClose={() => setContextualMenuPosition(null)}
            isOpen={true}>
            <DropdownTrigger>
              <div style={{ position: 'absolute', left: contextualMenuPosition.x, top: contextualMenuPosition.y, width: 1, height: 1, background: 'red'}}>⋮
              </div>
            </DropdownTrigger>
            <DropdownMenu disabledKeys={selectedTexts.length === 0 ? ['cut', 'copy'] : []} variant="flat" aria-label={t('Dropdown menu with shortcut')}>
              {[<DropdownItem key="cut"shortcut="⌘X" startContent={<MdContentCut />} onClick={cutSelection}>{t('Cut')}</DropdownItem>,
              <DropdownItem key="copy" shortcut="⌘C" startContent={<MdContentCopy />} onClick={copySelection}>{t('Copy')}</DropdownItem>,
              <DropdownItem key="paste" shortcut="⌘V" startContent={<MdContentPaste />} showDivider={selectedTexts.length > 0} onClick={pasteIntoSelection}>{t('Paste')}</DropdownItem>,
              <DropdownItem key="break" startContent={<CgArrowsBreakeH />} onClick={() => {
                const selectedTexts = useModelStore.getState().selectedTexts;
                if (selectedTexts.length > 0) {
                  // 结果写回发请求时标记的原文，等待期间可以点别处
                  const job = startJobForSelection(selectedTexts[0].selectionId);
                  runJob(job, new TextDistributer(selectedTexts[0].text).execute(), 'Break into sentences');
                }
              }}
              >{t('Break into sentences')}</DropdownItem>,
              <DropdownItem key="merge" startContent={<CgArrowsMergeAltH />} onClick={() => {
                const selectedTexts = useModelStore.getState().selectedTexts;
                if (selectedTexts.length > 0) {
                  // 结果写回发请求时标记的原文，等待期间可以点别处
                  const job = startJobForSelection(selectedTexts[0].selectionId);
                  runJob(job, new TextConsolidater(selectedTexts[0].text).execute(), 'Merge into one sentence');
                }
              }}
              >{t('Merge into one sentence')}</DropdownItem>,
          ].slice(0, selectedTexts.length === 0 ? 3 : 5)}
            </DropdownMenu>
          </Dropdown>}

        </div>
        {!disableTools && <Toolbar />}

        <div style={{ position: 'absolute', right: 0, top: 0, paddingTop: 20 + topOffset, paddingRight: 20, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 20, height: '100vh' }}>
          {!disableTonePicker && <TonePicker />}
          {!disableLayers && <LayerManager />}
          {!disableTools && <HistoryPanel style={{ flex: '1 1 0', minHeight: 150 }} />}
        </div>
      </div>
    </>
  )
}
