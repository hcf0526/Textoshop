import { Button } from '@nextui-org/react';
import { IoLanguage } from 'react-icons/io5';
import { useLanguageStore } from './index';

// 语言切换按钮，文字显示切换后的目标语言
export default function LanguageSwitch(props: { style?: React.CSSProperties }) {
    const lang = useLanguageStore((s) => s.lang);
    const toggle = useLanguageStore((s) => s.toggle);
    return (
        <Button size="sm" variant="flat" startContent={<IoLanguage />} onClick={toggle} style={props.style}
            aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}>
            {lang === 'zh' ? 'English' : '中文'}
        </Button>
    );
}
