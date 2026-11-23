import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Job, usePendingStore } from '../../model/PendingEdits';

// 改写任务计时，每个任务一个，显示在被改写文字最后一行的右侧
// 进行中显示秒数，结束后显示成功、失败或已修改 5 秒，位置停在最后一次找到文字的地方

const OFFSET = 8;

interface Pos { x: number, y: number }

function findPos(id: string): Pos | null {
    const elements = Array.from(document.querySelectorAll(`[data-pending-id="${id}"]`));
    for (let i = elements.length - 1; i >= 0; i--) {
        const rects = Array.from(elements[i].getClientRects()).filter(r => r.width > 0 && r.height > 0);
        const last = rects[rects.length - 1];
        if (last) return { x: last.right + OFFSET, y: last.top + last.height / 2 };
    }
    return null;
}

const BASE: React.CSSProperties = {
    position: 'fixed', transform: 'translateY(-50%)',
    zIndex: 100001, pointerEvents: 'none', whiteSpace: 'nowrap',
    fontSize: 12, fontWeight: 600, lineHeight: '18px', padding: '1px 8px', borderRadius: 9,
    boxShadow: 'rgba(0, 0, 0, 0.12) 0px 2px 8px', fontVariantNumeric: 'tabular-nums',
};

const STATUS_STYLE: Record<Exclude<Job['status'], 'running'>, { text: string, background: string, color: string }> = {
    success: { text: 'Request succeeded', background: '#e8faf0', color: '#12a150' },
    error: { text: 'Request failed', background: '#fee7ef', color: '#f31260' },
    modified: { text: 'Text changed', background: '#fff4e5', color: '#b45309' },
};

export default function RequestTimer() {
    const t = useT();
    const jobs = usePendingStore((s) => s.jobs);
    const [now, setNow] = useState(Date.now());
    const positions = useRef<Record<string, Pos>>({});
    const hasRunning = Object.values(jobs).some(j => j.status === 'running');

    // 有任务进行中时每 100 毫秒刷新秒数与位置
    useEffect(() => {
        if (!hasRunning) return;
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, [hasRunning]);

    // 清掉已移除任务的位置记录
    for (const id of Object.keys(positions.current)) if (!jobs[id]) delete positions.current[id];

    return <>
        {Object.values(jobs).map((job) => {
            if (job.status === 'running') {
                const pos = findPos(job.id);
                if (pos) positions.current[job.id] = pos;
            }
            const pos = positions.current[job.id];
            if (!pos) return null;
            const style = { ...BASE, left: pos.x, top: pos.y };
            if (job.status === 'running') {
                const seconds = Math.floor((now - job.startedAt) / 1000);
                return <div key={job.id} style={{ ...style, background: 'white', color: '#3f3f46' }}>{seconds} s</div>;
            }
            const s = STATUS_STYLE[job.status];
            return <div key={job.id} style={{ ...style, background: s.background, color: s.color }}>{t(s.text)}</div>;
        })}
    </>;
}
