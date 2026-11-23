import { Button, Card, CardBody, CardHeader, Divider, Input } from '@nextui-org/react';
import { useState } from 'react';
import { FaPaintBrush } from 'react-icons/fa';
import { useT } from '../i18n';
import { LoginError, useAuthStore } from '../model/AuthModel';

const ERROR_TEXT: Record<LoginError, string> = {
    invalid: 'Invalid username or password',
    locked: 'Too many attempts, try again later',
    network: 'Network error',
};

export default function LoginPage() {
    const t = useT();
    const login = useAuthStore((s) => s.login);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<LoginError | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (busy || !username || !password) return;
        setBusy(true);
        setError(await login(username.trim(), password));
        setBusy(false);
    }

    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Card style={{ width: 360 }}>
            <CardHeader>
                <span style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, fontWeight: 600 }}><FaPaintBrush /> Textoshop</span>
            </CardHeader>
            <Divider />
            <CardBody>
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={{ fontWeight: 800 }}>{t('Sign in')}</span>
                    <Input variant="faded" label={t('Username')} autoComplete="username" autoFocus
                        value={username} onValueChange={setUsername} />
                    <Input variant="faded" label={t('Password')} type="password" autoComplete="current-password"
                        value={password} onValueChange={setPassword}
                        isInvalid={error !== null} errorMessage={error ? t(ERROR_TEXT[error]) : undefined} />
                    <Button type="submit" color="primary" isLoading={busy} isDisabled={!username || !password}>
                        {t('Sign in')}
                    </Button>
                </form>
            </CardBody>
        </Card>
    </div>;
}
