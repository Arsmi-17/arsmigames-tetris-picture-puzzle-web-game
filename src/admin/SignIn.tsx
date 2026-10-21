import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { api, ApiError } from './api';

/** Admin sign-in with the email and key set in the site's environment. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ configured: boolean; emailSet: boolean; keySet: boolean; keyLongEnough: boolean; adminSettingNames?: string[] } | null>(null);
  const configured = setup?.configured ?? true;

  useEffect(() => {
    api<NonNullable<typeof setup>>('/api/admin/login').then(setSetup, () => undefined);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/login', { method: 'POST', body: { email, key } });
      setKey('');
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full rounded-xl border border-white/15 bg-[#0b1120] px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none';
  return (
    <form onSubmit={(event) => void submit(event)} className="mx-auto mt-10 grid max-w-sm gap-4 rounded-3xl border border-white/10 bg-[#151f32] p-6" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title" className="text-xl font-bold">Sign in to manage pictures</h1>
      {!configured && (
        <p role="alert" className="rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100">
          Sign-in is not set up on this deployment yet. This deployment received:
          <span className="mt-2 block font-mono text-xs">
            ADMIN_EMAIL: {setup?.emailSet ? 'set' : 'missing'} · ADMIN_KEY: {setup?.keySet ? (setup.keyLongEnough ? 'set' : 'too short (needs 4+)') : 'missing'}
          </span>
          {setup?.adminSettingNames && (
            <span className="mt-1 block font-mono text-xs">Names received: {setup.adminSettingNames.join(', ') || 'none'}</span>
          )}
          <span className="mt-2 block">Save them as Production secrets in the Pages project, then create a new deployment.</span>
        </p>
      )}
      <label className="block text-sm font-medium" htmlFor="admin-email">Email
        <input id="admin-email" className={input} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm font-medium" htmlFor="admin-key">Admin key
        <input id="admin-key" className={input} type="password" autoComplete="current-password" required value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      {error && <p role="alert" className="rounded-xl bg-rose-400/15 p-3 text-sm text-rose-100">{error}</p>}
      <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 font-bold text-[#0b1120] hover:bg-cyan-200 disabled:opacity-50"><LogIn className="h-5 w-5" /> {busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
