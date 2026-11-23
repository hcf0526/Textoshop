import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionTool } from 'openai/resources/index.mjs';
import { BaseEditor, BaseSelection, Editor, Node, Point, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { z } from 'zod';
import { create } from 'zustand';
import { useStudyStore } from '../study/StudyModel';
import { LAYER_COLOR_PALETTE } from '../view/components/LayerManager';
import { openai, requestSignal, resolveModel } from './LLMConfig';
import { cachedRequest } from './PromptCache';
import { DrawTool } from './tools/toolbarTools/DrawTool';
import { EraserTool } from './tools/toolbarTools/EraserTool';
import { PluralizerTool, SingularizerTool } from './tools/toolbarTools/PluralizerTool';
import { PrompterTool } from './tools/toolbarTools/PrompterTool';
import { RepairTool } from './tools/toolbarTools/RepairTool';
import { SelectionTool } from './tools/toolbarTools/SelectionTool';
import { SmudgeTool } from './tools/toolbarTools/SmudgeTool';
import { FutureTenseChangerTool, PastTenseChangerTool, PresentTenseChangerTool } from './tools/toolbarTools/TextTenseTools';
import { TonePickerTool } from './tools/toolbarTools/TonePickerTool';
import { ToolbarTool } from './tools/toolbarTools/ToolbarTool';
import { useUndoModelStore } from './UndoModel';
import { SlateUtils } from './utils/SlateUtils';
import { TextAnimationUtils } from './utils/TextAnimationUtils';
import { TextLayerUtils } from './utils/TextLayerUtils';


// OpenAI 客户端及 Base URL、密钥、模型配置见 LLMConfig.ts，这里保持原有导出路径
export { openai };


export interface TextFieldAnimation {
    timeout: NodeJS.Timeout
    storedState: Node[],
    storedSelection: BaseSelection
}


//@ts-ignore
window['Transforms'] = Transforms;
export const textFieldEditors : {[textFieldId: string]: BaseEditor & ReactEditor} = (window as any)["textFieldEditors"] = {}
export const temporaryTextFieldAnimation : {[textFieldId: string]: TextFieldAnimation | null} = {}

/** 
 * Useful structures 
 **/
export interface MessageGPT {
    role: "user" | "assistant" | "system",
    content: string
}

export interface ToneLevel {
    lowAdjective: string
    highAdjective: string
    value: number
}


export interface TextSelection {
    textFieldId : string
    startPoint: Point
    endPoint: Point
    text : string
    selectionId: number
    isLoading?: boolean
}

export interface ExecutablePrompt {
    prompt: string
    model?: string
    tools?: Array<ChatCompletionTool>
    json?: boolean,
    response_format?: {zodObject: z.ZodType, name: string}
}

export interface PromptResult {
    result: string,
    parsed?: any
}

export interface MoveableTextField {
    x: number
    y: number
    width: number
    height: number
    isMoveable: boolean
    id: string,
    state: Node[],
    isVisible: boolean
}

export type TextLayer = {
    name: string,
    isVisible: boolean
    modifications: {[tag: string]: string}
    color: string
}

export interface MainLayer extends TextLayer {
    state: Node[]
}

export type HiearchicalLayer = {
    id: string,
    layer: TextLayer,
    children?: HiearchicalLayer[],
}

export type HiearchicalMainLayer = {
    id: string,
    layer: MainLayer,
    children?: HiearchicalLayer[],
}

export type TextLayers = [MainLayer, ...TextLayer[]]
export type HiearchicalLayers = [HiearchicalMainLayer, ...HiearchicalLayer[]]


/** 
 * Model 
 **/
export interface ModelState {
    inMultipleSelectionMode: boolean
    selectedTexts: TextSelection[]
    selectedTool: string
    textFields: MoveableTextField[]
    editors : {[textFieldId: string]: BaseEditor & ReactEditor}
    layers: HiearchicalLayers
    selectedLayerId: number
    animateChangesUntilTimestamp: number
    tone: ToneLevel[];
    toolsOrderInToolbar: string[][];
}

interface ModelAction {
    setInMultipleSelectionMode: (inMultipleSelectionMode: boolean) => void
    setSelectedTexts: (selectedTexts: TextSelection[], removeTextFieldIfEmpty? : boolean ) => void
    reset: () => void
    executePrompt: (prompt: ExecutablePrompt) => Promise<PromptResult>
    setSelectedTool: (tool: string) => void
    getSelectedTool: () => ToolbarTool
    setTextFields: (textFields: MoveableTextField[]) => void
    setTextField: (textFieldId: string, newTextFieldData: Partial<MoveableTextField>) => void
    removeTextField: (textFieldId: string) => void
    setSelectedLayer: (layerId: number) => void
    setLayerVisibility: (layerId: number, isVisible: boolean) => void
    setLayerProperties: (layerId: number, properties: {[tag: string]: any}) => void
    animateNextChanges: () => void
    refreshTextFields: (force?: boolean) => void
    removeLayer: (layerId: number) => void
    moveLayer: (layerId: number, targetParentId: number | null, idWithinParent: number) => void
    addLayer: (layer: HiearchicalLayer, parentId: number | null, idWithinParent: number) => void
    setTone: (tone: ToneLevel[]) => void
    setToolOrderInToolbar: (toolsOrderInToolbar: string[][]) => void
}



export const tools : {[toolName: string]: ToolbarTool} = {}



function getInitialState() {
    const toolsOrderInToolbar : string[][] = [
        [(tools[SelectionTool.getToolName()] = new SelectionTool()).name], 
        [(tools[DrawTool.getToolName()] = new DrawTool()).name], 
        [(tools[TonePickerTool.getToolName()] = new TonePickerTool()).name], 
        [(tools[SmudgeTool.getToolName()] = new SmudgeTool()).name], 
        [
            (tools[PluralizerTool.getToolName()] = new PluralizerTool()).name,
            (tools[SingularizerTool.getToolName()] = new SingularizerTool()).name
        ], 
        [
            (tools[PastTenseChangerTool.getToolName()] = new PastTenseChangerTool()).name,
            (tools[PresentTenseChangerTool.getToolName()] = new PresentTenseChangerTool()).name,
            (tools[FutureTenseChangerTool.getToolName()] = new FutureTenseChangerTool()).name
        ],

        [(tools[RepairTool.getToolName()] = new RepairTool()).name], 
        [(tools[EraserTool.getToolName()] = new EraserTool()).name], 
        [(tools[PrompterTool.getToolName()] = new PrompterTool()).name]
    ]

    // 默认示例为中文组员催交消息，语气随意且消极，便于演示语气取色器与调整长度
    const startingLayers = [
        { id: "1", layer: { name: "Layer 1", color: "white", isVisible: true, state: [{
            //@ts-ignore
            type: "paragraph",
            children: [{ text: `老王，那个项目报告到底咋回事啊？说好周五交，结果拖到现在连个影子都没有。大家天天在群里等你，你倒好，消息没回，电话也没人听。说实话我真的挺烦的，这已经是这学期第二回了。

上次中期答辩你也是拖到最后一晚才把材料甩过来，PPT 里的数据对没对上都没人知道，害得我们几个熬到凌晨三点一页一页地改。老师当场就问我们组是没好好做吗，那种滋味你能体会吗？

下周一要是报告还没到，咱们组这次分数肯定完蛋，到时候你自己去跟老师解释吧。你要是真有什么难处，就直说，大家都愿意帮忙。可你一声没吭，谁也没法替你扛。` }]
        }], modifications: {} }, 
                children: [] },
                { id: "2", layer: { name: "Layer 2", color: LAYER_COLOR_PALETTE[0], isVisible: true, modifications: {} }, children: [] },
        { id: "3", layer: { name: "Layer 3", color: LAYER_COLOR_PALETTE[1], isVisible: true, modifications: {} }, children: [] },
        
    ]

    const initialState: ModelState = {
        inMultipleSelectionMode: false,
        selectedTexts: [],
        selectedTool: SelectionTool.getToolName(),
        editors: {},
        animateChangesUntilTimestamp: 0,
        tone: [
            { lowAdjective: "Informal", highAdjective: "Formal", value: 5 },
            { lowAdjective: "Negative", highAdjective: "Positive", value: 5 },
            { lowAdjective: "Complicated", highAdjective: "Simple", value: 5 },
        ],
        layers: startingLayers as any,
        selectedLayerId: 0,
        textFields: [
            {
                x: -1, y: -1, width: -1, height: -1, isMoveable: false,
                id: "mainTextField",
                state: TextLayerUtils.getStateFromLayers(startingLayers as any),
                isVisible: true
            },
        ],
        toolsOrderInToolbar: toolsOrderInToolbar
    }

    return initialState;
}

function forEachEditor<Type>(array : Type [], textFieldIdRetriever: (e : Type) => string, fn: (element : Type, editor: BaseEditor & ReactEditor, textFieldId: string) => void) {
    array.forEach((e) => {
        const textFieldId = textFieldIdRetriever(e);
        const editor = textFieldEditors[textFieldId];
        if (editor) {
            fn(e, editor, textFieldId);
        }
    });
}

// 发送一次大模型请求，失败时 reject
async function runPrompt(executablePrompt: ExecutablePrompt): Promise<PromptResult> {
    const logEvent = useStudyStore.getState().logEvent;

    const uniqueId = Math.random().toString(36).substring(7);
    const signal = requestSignal(); // 超时后中止，计时器显示请求失败

    if (executablePrompt.response_format) {
        const completion = openai.beta.chat.completions.parse({
            model: resolveModel(executablePrompt.model),
            messages: [{ role: 'user', content: executablePrompt.prompt }],
            temperature: 0,
            response_format: zodResponseFormat(executablePrompt.response_format.zodObject, executablePrompt.response_format.name)
        }, { signal })

        logEvent("PROMPT_SENT_TO_GPT", {...executablePrompt, uniqueId: uniqueId});

        return new Promise<PromptResult>(async (resolve, reject) => {
            completion.then((result) => {
                const message = result.choices[0]?.message;
                if (message?.parsed) {
                    logEvent("RESULT_FROM_GPT", {uniqueId: uniqueId, response: message.content});
    
                    resolve({ result: message.content || "", parsed: message.parsed });
                } else {
                    reject(new Error("Empty parsed result"));
                }
            }).catch(reject);
        });

        
    } else {
        const sendRequest = (useJsonFormat: boolean) => openai.chat.completions.create({
            model: resolveModel(executablePrompt.model),
            messages: [{ role: 'user', content: executablePrompt.prompt }],
            stream: true,
            temperature: 0,
            response_format: useJsonFormat ? { "type": "json_object" } : undefined,
        }, { signal });

        let stream: Awaited<ReturnType<typeof sendRequest>>;
        try {
            stream = await sendRequest(!!executablePrompt.json);
        } catch (error: any) {
            // 部分兼容服务不支持 response_format，去掉该参数重试，结果由 PromptParserUtils 容错解析
            if (executablePrompt.json && error?.status === 400) {
                stream = await sendRequest(false);
            } else {
                throw error;
            }
        }

        logEvent("PROMPT_SENT_TO_GPT", {...executablePrompt, uniqueId: uniqueId});

        return new Promise<PromptResult>(async (resolve, reject) => {
            let completeResult = "";
            try {
                for await (const chunk of stream) {
                    const chunkStr = chunk.choices[0]?.delta?.content || '';
                    completeResult += chunkStr;
                }
            } catch (error) {
                reject(error);
                return;
            }
            logEvent("RESULT_FROM_GPT", {uniqueId: uniqueId, response: completeResult});

            resolve({ result: completeResult });
        });
    }
}

export const useModelStore = create<ModelState & ModelAction>()((set, get) => ({
    ...getInitialState(),
    reset: () => {
        set((state) => ({ ...getInitialState() })),
        get().refreshTextFields();
    },
    setInMultipleSelectionMode: (inMultipleSelectionMode) => set((state) => ({ inMultipleSelectionMode: inMultipleSelectionMode })),
    setSelectedTool: (tool) => {
        set((state) => ({ selectedTool: tool }))
        useStudyStore.getState().logEvent("TOOL_SELECTED", {tool: tool});
    },
    getSelectedTool: () => tools[get().selectedTool],
    // 相同的模型、提示词与输出格式命中缓存时直接返回，见 PromptCache.ts
    executePrompt: (executablePrompt) => {
        const key = JSON.stringify([
            resolveModel(executablePrompt.model),
            executablePrompt.prompt,
            !!executablePrompt.json,
            executablePrompt.response_format?.name ?? null,
        ]);
        return cachedRequest(key, () => runPrompt(executablePrompt)).catch((error) => {
            // 请求失败时停止选区的闪烁，再把错误抛给调用方
            console.error(error);
            set((state) => ({ selectedTexts: state.selectedTexts.map(t => t.isLoading ? { ...t, isLoading: false } : t) }));
            throw error;
        });
    },
    setTextFields: (textFields) => {
        const previousTextFields = get().textFields;

        let isTemporaryChange = false;

        // Only store the textFields whose states do not contain the differences variable
        const textFieldsToStore = textFields.map(e => {
            const textField = previousTextFields.filter(e2 => e2.id === e.id);
            if (textField.length === 1 && e.state.length > 0 && (e.state[0] as any).differences) {
                isTemporaryChange = true;
                // Do not store text fields that are temporary
                return textField[0];
            }
            return e;
        });

        if (!isTemporaryChange && textFields.map(t => Node.string(t.state[0])).join("\n") !== previousTextFields.map(t => Node.string(t.state[0])).join("\n")) {
            useUndoModelStore.getState().storeUndoStateDebounced();
        }

        // Text fields have changed. We should check the selections and update them in the model
        const selections : TextSelection[] = [];
        forEachEditor(textFieldsToStore, e => e.id, (textField, editor, textFieldId) => {
            const nodes = Editor.nodes(editor, { at: [], mode: 'all', match: (n : any) => n.selectionId !== undefined });

            for (const [node, path] of nodes) { 
                const previousSelection = get().selectedTexts.filter(e => e.textFieldId === textFieldId && e.selectionId === (node as any).selectionId);
                const nodeString = Node.string(node);
                selections.push({
                    textFieldId: textFieldId,
                    startPoint: { path: path, offset: 0 },
                    endPoint: { path: path, offset: nodeString.length },
                    text: nodeString,
                    selectionId: (node as any).selectionId,
                    isLoading: previousSelection.length === 1 ? previousSelection[0].isLoading : false // Make sure we preserve the loading state
                });
            }
        });
        // Sort the selections by their selectionId
        selections.sort((a, b) => a.selectionId - b.selectionId);


        set((state) => ({ textFields: textFieldsToStore, selectedTexts: selections}))

        //const layers = TextLayerUtils.flattenHierarchicalLayers(get().layers);
        forEachEditor(textFields, e => e.id, (textField, editor, textFieldId) => {
            if (textFieldId === "mainTextField" && !(textField.state[0] as any).differences) {
                const previousTextField = previousTextFields.filter(e => e.id === textFieldId);
                const previousState = previousTextField[0].state;
                const newState = textField.state;

                if (get().layers[0].layer.state.length === 0 || previousState.map(e => Node.string(e)).join("\n") !== newState.map(e => Node.string(e)).join("\n")) {
                    // Update the text layers (only for the main text field)
                    // TODO: Support multiple text fields
                    const updatedTextLayers = TextLayerUtils.updateLayersFromNewState(get().layers, get().selectedLayerId, textField.state);

                    if (updatedTextLayers) {
                        set((state) => ({ layers: JSON.parse(JSON.stringify(updatedTextLayers)) }));

                        // Immediately update the text fields to reflect the changes
                        const stateCalculatedFromLayers = TextLayerUtils.getStateFromLayers(updatedTextLayers);
                        
                        //if (newState.map(e => Node.string(e)).join("\n") !== stateCalculatedFromLayers.map(e => Node.string(e)).join("\n")) {

                            // Update the selection to match the new state by finding the corresponding node at the same index in the new state
                            const newStateIndexPosition = SlateUtils.toStrIndex(newState, editor.selection?.anchor || { path: [], offset: 0 });
                            let updatedPoint = SlateUtils.toSlatePoint(stateCalculatedFromLayers, newStateIndexPosition);
                            if (updatedPoint === null) {
                                // Set to the end of the document in this case
                                updatedPoint = Editor.end(editor, []);
                            }
                            editor.selection = updatedPoint ? { anchor: updatedPoint, focus: updatedPoint } : null;
                            editor.children = stateCalculatedFromLayers;
                            editor.onChange();
                        //}
                    }
                }
            }
        });

        if (Date.now() < get().animateChangesUntilTimestamp) {
            // Potentially trigger an animation to show the differences
            forEachEditor(textFields, e => e.id, (textField, editor, textFieldId) => {
                const previousTextField = previousTextFields.filter(e => e.id === textFieldId);

                if (previousTextField.length === 1 && !(textField.state[0] as any).differences) { // Make sure we are not animating a temporary state
                    const previousState = previousTextField[0].state;
                    const newState = textField.state;

                    const highlightedDiffsNode = TextAnimationUtils.getHighlightedNodeDifference(previousState, newState);

                    if (highlightedDiffsNode.length > 0) {
                        TextAnimationUtils.startTextFieldAnimation(textFieldId, editor, newState, highlightedDiffsNode);
                    }
                }
            });
        }
    },
    setTextField: (textFieldId, newTextFieldData) => {
        const textFields = get().textFields;
        const updatedTextFields = textFields.map(e => {
            if (e.id === textFieldId) {
                return { ...e, ...newTextFieldData }
            }
            return e;
        });
        set((state) => ({ textFields: updatedTextFields }));
    },
    removeTextField: (textFieldId) => {
        useStudyStore.getState().logEvent("TEXT_FIELD_REMOVED", {textFieldId: textFieldId});
        // Just make the field invisible
        const textFields = get().textFields;
        const updatedTextFields = textFields.map(e => {
            if (e.id === textFieldId) {
                return { ...e, isVisible: false }
            }
            return e;
        });
        set((state) => ({ textFields: [...updatedTextFields] }));

        //set((state) => ({ textFields: [...state.textFields.filter(e => e.id !== textFieldId)] }));
    },
    setSelectedTexts: (selectedTexts, removeTextFieldIfEmpty = false) => {
        if (selectedTexts.length === 0) {
            forEachEditor(get().textFields, e => e.id, (textField, editor, textFieldId) => {
                Transforms.unsetNodes(editor, ['selection', 'selectionId', 'selectionClassname'], { at: [], mode: 'all', match: (n : any) => n.selection });
            });
        } else {
            // Allow editing text of the selection (no support for changing the range becaue it gets too messy)
            forEachEditor([...new Set(selectedTexts.map(e => e.textFieldId))], e => e, (_, editor, textFieldId) => {
                // Make sure nothing is selected because we are managing the selection ourselves
                editor.deselect();

                const nodes = Editor.nodes(editor, { at: [], mode: 'all', match: (n : any) => n.selectionId !== undefined });

                for (const [node, path] of nodes) { 
                    // Only edit if the text is different
                    const selectionId = (node as any).selectionId;
                    const correspondingSelectedText = selectedTexts.find(e => e.selectionId === selectionId);
                    if (correspondingSelectedText && Node.string(node) !== correspondingSelectedText.text) {
                        // If the text is completely removed, we should place the cursor where it was so that text can be entered in its place
                        if (correspondingSelectedText.text.length === 0) {
                            if (Node.string(editor) !== Node.string(node)) {
                                editor.select(path)
                            }
                        }
                        Transforms.insertText(editor, correspondingSelectedText.text, { at: path });

                        if (Node.string(editor).length === 0) {
                            // The transformation removed ALL the text of the editor.
                            if (removeTextFieldIfEmpty && textFieldId !== "mainTextField") { 
                                // We remove the text field if it is empty
                                get().removeTextField(textFieldId);
                            } else {
                                //  We clean the tree and place the cursor at the very beginning
                                editor.children = [{
                                    //@ts-ignore
                                    type: "paragraph",
                                    children: [{ text: "" }]
                                }]
                                editor.select(Editor.start(editor, []));
                                editor.onChange();
                            }
                        }
                    }
                }
            });
        }
        set((state) => ({ selectedTexts: selectedTexts }))
    },
    refreshTextFields: (force : boolean = false) => {
        const textFields = get().textFields;
        for (const textField of textFields) {
            if (textField.id === "mainTextField") {
                const newState = TextLayerUtils.getStateFromLayers(get().layers);
                const editor = textFieldEditors[textField.id];
                if (editor) {
                    editor.children = newState;
                    editor.onChange();
                }
                
                if (!editor || force) {
                    // Seems like the editor is not mounted yet. Then we directly set the value of the text field
                    textField.state = newState;
                    set((state) => ({ textFields: [...state.textFields] }));
                }
            } else {
                const editor = textFieldEditors[textField.id];
                if (editor) {
                    editor.children = textField.state;
                    editor.onChange();
                }
            
            }
        }
    },


    setSelectedLayer: (layerId) => {
        if (layerId !== get().selectedLayerId) {
            useStudyStore.getState().logEvent("LAYER_SELECTED", {layerId: layerId});
            set((state) => ({ selectedLayerId: layerId }))
        }
    },
    setLayerVisibility: (layerId, isVisible) => {
        const layers = get().layers;
        TextLayerUtils.flattenHierarchicalLayersWithParent(layers).forEach((layerWithParent, index) => {
            if (index === layerId) {
                useStudyStore.getState().logEvent("LAYER_VISIBILITY_CHANGED", {layerId: layerId, isVisible: isVisible, layerName: layerWithParent.hlayer.layer.name});
                if (isVisible) {
                    // Recursively loop through the parents to make sure they are visible too
                    let parent = layerWithParent.parent;
                    while (parent) {
                        parent.hlayer.layer.isVisible = true;
                        parent = parent.parent;
                    }
                } else {
                    // Recursively loop through the children to make sure they are invisible too
                    const children = layerWithParent.hlayer.children;
                    if (children) {
                        const stack = [...children];
                        while (stack.length > 0) {
                            const current = stack.shift();
                            if (current && current.children) {
                                current.layer.isVisible = false;
                                stack.push(...current.children);
                            }
                        }
                    }
                }
                layerWithParent.hlayer.layer.isVisible = isVisible;
            }
        });

        //get().setLayerProperties(layerId, { isVisible: isVisible });
        // Immediately update the text fields to reflect the changes
        get().refreshTextFields();
    },
    setLayerProperties: (layerId, properties) => {
        const layers = get().layers;
        // The layer id assumes a flat list of layer. So we loop through the layers recursively (depth first) to find the layer
        const layersToGoThrough : HiearchicalLayer[] = [...layers];
        let currentId = 0;
        while (layersToGoThrough.length > 0) {
            const currentLayer = layersToGoThrough.shift();
            if (currentLayer) {
                if (currentId === layerId) {
                    useStudyStore.getState().logEvent("LAYER_PROPERTIES_CHANGED", {layerId: layerId, properties: properties, layerName: currentLayer.layer.name});
                    currentLayer.layer = { ...currentLayer.layer, ...properties };
                    break;
                }
                if (currentLayer.children) {
                    // Add at the beginning of the layersToGoThrough
                    layersToGoThrough.unshift(...currentLayer.children);
                }
            }
            currentId++;
        }
        set((state) => ({ layers: [...layers] }));
    },
    /**
     * Animate all the text changes happening within the next 200ms
     */
    animateNextChanges: () => {
        set((state) => ({ animateChangesUntilTimestamp: Date.now() + 200 }))
    },
    removeLayer: (layerId) => {
        if (layerId === 0) {
            return; // We cannot remove the main layer
        }
        const layersToEdit = get().layers;
        const flattenedLayersWithParents = TextLayerUtils.flattenHierarchicalLayersWithParent(layersToEdit);

        if (layerId < flattenedLayersWithParents.length) {
            const layerToRemove = flattenedLayersWithParents[layerId];

            // Remove the layer from the children of the parent
            const parent = layerToRemove.parent;
            const indexWithinParent = layerToRemove.indexWithinParent;
            if (parent && parent.hlayer.children) {
                parent.hlayer.children.splice(indexWithinParent, 1);
            } else {
                // The layer is one of the "root" layers, we remove it from the hiearchical layers directly
                layersToEdit.splice(indexWithinParent, 1);
            }

            if (layerId === get().selectedLayerId) {
                // Need to move the selection so that it is not on the removed layer
                // We move it to the closest layer to the one removed
                get().setSelectedLayer(layerId-1);
            }

            useStudyStore.getState().logEvent("LAYER_REMOVED", {layerId: layerId, layerName: layerToRemove.hlayer.layer.name});

            set((state) => ({ layers: [...layersToEdit] }));
            get().refreshTextFields();
        }
    },
    addLayer: (layer, parentId, idWithinParent) => {
        const layersToEdit = get().layers;
        const flattenedLayers = TextLayerUtils.flattenHierarchicalLayers(layersToEdit);

        if (parentId === null) {
            // Add the layer at the root
            layersToEdit.splice(idWithinParent, 0, layer);
        } else {
            if (parentId < flattenedLayers.length) {
                const parent = flattenedLayers[parentId];
                if (parent.children && parent.children.length >= idWithinParent) {
                    parent.children.splice(idWithinParent, 0, layer);
                }
            }
        }

        // Find the id of the new layer
        const newLayerId = TextLayerUtils.flattenHierarchicalLayers(layersToEdit).findIndex(e => e === layer);
        if (newLayerId !== -1) layer.id = newLayerId.toString();

        useStudyStore.getState().logEvent("LAYER_ADDED", {layerName: layer.layer.name, parentId: parentId, idWithinParent: idWithinParent});

        set((state) => ({ layers: [...layersToEdit] }));
        get().refreshTextFields();
    },
    moveLayer: (layerId, targetParentId, idWithinParent) => {
        const layersToEdit = get().layers;
        const flattenedLayers = TextLayerUtils.flattenHierarchicalLayers(layersToEdit);

        if (layerId < flattenedLayers.length && layerId > 0 /* first layer cannot be dragged */) {
            const layerToMove = flattenedLayers[layerId];

            const targetId = targetParentId === null ? idWithinParent : targetParentId + idWithinParent;

            if (targetId < 0 || targetId > flattenedLayers.length) return;

            // The order of the remove/add will depend if the destination is higher or lower than the current position
            if (targetId < layerId) {
                // Layer is moved higher up in the hierarchy. We should remove first
                get().removeLayer(layerId);
                get().addLayer(layerToMove, targetParentId, idWithinParent);
            } else {
                // Layer is moved lower in the hierarchy. We should add first
                get().addLayer(layerToMove, targetParentId, idWithinParent);
                get().removeLayer(layerId);
            }

            useStudyStore.getState().logEvent("LAYER_MOVED", {layerId: layerId, targetParentId: targetParentId, idWithinParent: idWithinParent});
        }
    },
    setTone: (tone) => {
        set((state) => ({ tone: tone }))
    },
    setToolOrderInToolbar: (toolsOrderInToolbar) => set((state) => ({ toolsOrderInToolbar: toolsOrderInToolbar })),
}))


//         
