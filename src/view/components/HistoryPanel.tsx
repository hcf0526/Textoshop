import { Card, CardBody, CardHeader } from "@nextui-org/react";
import { useEffect, useRef } from "react";
import { FaHistory } from "react-icons/fa";
import { useT } from "../../i18n";
import { useUndoModelStore } from "../../model/UndoModel";

// 历史记录面板，仿照绘图软件，每行一步操作，点击跳到该步
// 第 0 行为打开时的状态，当前步高亮，可重做的步显示为灰色

function formatTime(time: number) {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function HistoryPanel(props: { style?: React.CSSProperties }) {
  const t = useT();
  const undoMeta = useUndoModelStore(s => s.undoMeta);
  const redoMeta = useUndoModelStore(s => s.redoMeta);
  const sessionStart = useUndoModelStore(s => s.sessionStart);
  const jumpTo = useUndoModelStore(s => s.jumpTo);
  const listRef = useRef<HTMLDivElement>(null);

  // redoMeta 的栈顶是下一步，显示时倒序排在当前步之后
  const rows = [
    { label: 'Open', time: sessionStart },
    ...undoMeta,
    ...[...redoMeta].reverse(),
  ];
  const current = undoMeta.length;

  // 新增操作时滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [undoMeta.length, redoMeta.length]);

  return <Card style={{ width: 250, ...props.style }}>
    <CardHeader>
      <span style={{ fontWeight: 600 }}>{t('History')}</span>
    </CardHeader>
    <CardBody style={{ margin: 0, padding: '0 0 8px 0', minHeight: 0 }}>
      <div ref={listRef} style={{ overflowY: 'auto', height: '100%' }}>
        {rows.map((row, index) => {
          const isCurrent = index === current;
          const isFuture = index > current;
          return <div key={index} onClick={() => jumpTo(index)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', cursor: 'pointer',
              fontSize: 14, userSelect: 'none',
              background: isCurrent ? '#D7E7FA' : undefined,
              color: isFuture ? '#AAAEB1' : 'black',
            }}
            className={isCurrent ? undefined : "hover:bg-default-100"}>
            <FaHistory size={11} style={{ flexShrink: 0, color: isFuture ? '#AAAEB1' : '#71717B' }} />
            <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(row.label)}</span>
            <span style={{ fontSize: 12, color: '#AAAEB1', fontVariantNumeric: 'tabular-nums' }}>{formatTime(row.time)}</span>
          </div>;
        })}
      </div>
    </CardBody>
  </Card>;
}
