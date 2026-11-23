import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Tooltip } from '@nextui-org/react';
import { useEffect, useState } from 'react';
import { IoEye, IoEyeOff, IoSettingsSharp } from 'react-icons/io5';
import { useT } from '../i18n';
import { useChromeStore } from './ChromeModel';
import { useAuthStore } from '../model/AuthModel';
import { DEFAULT_TIMEOUT } from '../model/LLMConfig';
import { LLMSettings, SaveError, useSettingsStore } from '../model/SettingsModel';

const SAVE_ERROR_TEXT: Record<SaveError, string> = {
    bad_base_url: 'Base URL must start with http:// or https://',
    bad_timeout: 'Between 5 and 600 seconds',
    failed: 'Save failed',
};

// 齿轮按钮，打开设置弹窗
export default function SettingsButton(props: { style?: React.CSSProperties }) {
    const t = useT();
    const openDialog = useChromeStore((s) => s.openDialog);
    return <Tooltip content={t('Settings')} placement="right">
        <Button isIconOnly size="sm" variant="flat" aria-label={t('Settings')} onClick={() => openDialog('settings')} style={props.style}>
            <IoSettingsSharp />
        </Button>
    </Tooltip>;
}

// 模型设置弹窗，保存大模型配置到当前账号，菜单栏与齿轮按钮都可以打开
export function SettingsDialog() {
    const t = useT();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const save = useSettingsStore((s) => s.save);
    const apiKeySet = useSettingsStore((s) => s.apiKeySet);
    const apiKeyHint = useSettingsStore((s) => s.apiKeyHint);
    const open = useChromeStore((s) => s.dialog === 'settings');
    const openDialog = useChromeStore((s) => s.openDialog);
    const setOpen = (v: boolean) => openDialog(v ? 'settings' : null);
    const [form, setForm] = useState<LLMSettings>(() => useSettingsStore.getState().settings);
    const [apiKey, setApiKey] = useState('');
    const [timeoutText, setTimeoutText] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<SaveError | null>(null);

    // 每次打开时用当前配置填充表单
    useEffect(() => { if (open) resetForm(); }, [open]);

    function resetForm() {
        const current = useSettingsStore.getState().settings;
        setForm(current);
        setApiKey('');
        setTimeoutText(String(current.timeout));
        setShowKey(false);
        setError(null);
    }

    async function submit() {
        // 超时时间留空时用默认值
        const timeout = timeoutText.trim() === '' ? DEFAULT_TIMEOUT : Number(timeoutText);
        if (!Number.isInteger(timeout) || timeout < 5 || timeout > 600) {
            setError('bad_timeout');
            return;
        }
        setBusy(true);
        const err = await save({ ...form, timeout }, apiKey.trim());
        setBusy(false);
        setError(err);
        if (!err) setOpen(false);
    }

    const update = (k: 'baseURL' | 'model') => (v: string) => setForm({ ...form, [k]: v });

    return <>
        <Modal isOpen={open} onOpenChange={setOpen} size="md">
            <ModalContent>
                <ModalHeader style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 48 }}>
                    <span>{t('Settings')}</span>
                    <span style={{ fontSize: 14, fontWeight: 400, color: '#71717a' }}>{user}</span>
                </ModalHeader>
                <ModalBody>
                    <span style={{ fontWeight: 800 }}>{t('Model settings')}</span>
                    <Input variant="faded" label={t('Base URL')} placeholder="https://api.openai.com/v1"
                        value={form.baseURL} onValueChange={update('baseURL')}
                        isInvalid={error === 'bad_base_url'} errorMessage={error === 'bad_base_url' ? t(SAVE_ERROR_TEXT.bad_base_url) : undefined} />
                    <Input variant="faded" label={t('API Key')} placeholder={apiKeySet ? `${t('Saved')} ····${apiKeyHint}` : 'sk-...'} autoComplete="off"
                        type={showKey ? 'text' : 'password'} value={apiKey} onValueChange={setApiKey}
                        endContent={
                            <button type="button" onClick={() => setShowKey(!showKey)} aria-label={t(showKey ? 'Hide' : 'Show')}
                                style={{ color: '#71717a', alignSelf: 'center' }}>
                                {showKey ? <IoEyeOff /> : <IoEye />}
                            </button>
                        } />
                    <Input variant="faded" label={t('Model ID')} placeholder="gpt-4o"
                        value={form.model} onValueChange={update('model')} />
                    <Input variant="faded" label={t('Timeout')} placeholder={String(DEFAULT_TIMEOUT)} inputMode="numeric"
                        value={timeoutText} onValueChange={setTimeoutText}
                        endContent={<span style={{ color: '#71717a', fontSize: 14, alignSelf: 'center' }}>s</span>}
                        isInvalid={error === 'bad_timeout'} errorMessage={error === 'bad_timeout' ? t(SAVE_ERROR_TEXT.bad_timeout) : undefined} />
                    <Switch size="sm" isSelected={form.disableThinking} onValueChange={(v) => setForm({ ...form, disableThinking: v })}>
                        {t('Disable thinking')}
                    </Switch>
                    {error === 'failed' && <span style={{ color: '#f31260', fontSize: 14 }}>{t(SAVE_ERROR_TEXT.failed)}</span>}
                </ModalBody>
                <ModalFooter style={{ justifyContent: 'space-between' }}>
                    <Button variant="flat" color="danger" onClick={logout}>{t('Sign out')}</Button>
                    <span style={{ display: 'flex', gap: 8 }}>
                        <Button variant="light" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
                        <Button color="primary" isLoading={busy} onClick={submit}>{t('Save')}</Button>
                    </span>
                </ModalFooter>
            </ModalContent>
        </Modal>
    </>;
}
