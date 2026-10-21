import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Eye, LogOut, Pencil, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { CHALLENGE_LADDER } from '@/challenge';
import { api, ApiError, type AdminPicture, type CatalogStatus, type ImageReport, type PublishOutcome } from './api';
import { PictureEditor } from './PictureEditor';
import { AdminPreview } from './AdminPreview';
import { SignIn } from './SignIn';

type Load = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'error'; message: string } | { kind: 'ready' };

const STATUS_STYLE: Record<AdminPicture['status'], string> = {
  draft: 'bg-slate-500/20 text-slate-200',
  published: 'bg-emerald-400/15 text-emerald-300',
  unpublished: 'bg-amber-400/15 text-amber-200',
};

/** Include the specific image check failures, not just the summary. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong.';
  const report = error instanceof ApiError ? (error.body.report as ImageReport | undefined) : undefined;
  const details = [...(report?.image.errors ?? []), ...(report?.thumb?.errors ?? [])];
  return details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message;
}

function levelLabel(level: number) {
  return CHALLENGE_LADDER[level]?.label ?? `Level ${level}`;
}

export function AdminApp() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [pictures, setPictures] = useState<AdminPicture[]>([]);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [editing, setEditing] = useState<AdminPicture | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<AdminPicture | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [me, list] = await Promise.all([
        api<{ email: string }>('/api/admin/me'),
        api<{ pictures: AdminPicture[]; status: CatalogStatus }>('/api/admin/pictures'),
      ]);
      setEmail(me.email);
      setPictures(list.pictures);
      setStatus(list.status);
      setLoad({ kind: 'ready' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setLoad({ kind: 'signed-out' });
      else setLoad({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load the catalog.' });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Report the outcome of a write. */
  const report = useCallback((done: string, catalog?: PublishOutcome) => {
    setNotice({ tone: 'ok', text: catalog ? `${done}. Players will see it within about a minute.` : `${done}.` });
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined);
    setPictures([]);
    setLoad({ kind: 'signed-out' });
  }, []);

  const run = useCallback(async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
    } finally {
      setBusy(null);
      await refresh();
    }
  }, [refresh]);

  const setPublished = (picture: AdminPicture, publish: boolean) => run(picture.id, async () => {
    const result = await api<{ catalog: PublishOutcome }>(`/api/admin/pictures/${picture.id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' });
    report(`${picture.title} ${publish ? 'published' : 'unpublished'}`, result.catalog);
  });

  const move = (index: number, delta: number) => run('reorder', async () => {
    const ids = pictures.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    const result = await api<{ catalog?: PublishOutcome }>('/api/admin/reorder', { method: 'POST', body: { ids } });
    report('Order saved', result.catalog);
  });

  const republish = () => run('publish', async () => {
    const result = await api<{ catalog: PublishOutcome }>('/api/admin/publish', { method: 'POST' });
    report('Public pictures refreshed', result.catalog);
  });

  if (load.kind === 'loading') return <Shell><p className="text-slate-300" role="status">Loading catalog…</p></Shell>;
  if (load.kind === 'signed-out') return <Shell><SignIn onSignedIn={() => { setLoad({ kind: 'loading' }); void refresh(); }} /></Shell>;
  if (load.kind === 'error') {
    return <Shell><p role="alert" className="text-rose-200">{load.message}</p><button type="button" onClick={() => void refresh()} className="mt-4 rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Try again</button></Shell>;
  }

  const published = pictures.filter((p) => p.status === 'published').length;
  const themes = [...new Set(pictures.map((p) => p.theme))].sort();

  return (
    <Shell email={email} onSignOut={() => void signOut()}>
      <section aria-label="What players see" className="rounded-2xl border border-white/10 bg-[#151f32] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div className="text-sm">
              <p className="font-semibold">{published} published · {pictures.length} total</p>
              <p className="text-slate-300">
                Changes reach players within about a minute.
                {status?.latest && <> Last change: {new Date(status.latest.finished_at ?? status.latest.started_at).toLocaleString()}.</>}
              </p>
            </div>
          </div>
          <button type="button" onClick={republish} disabled={busy !== null} title="Clear the cached picture list now" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy === 'publish' ? 'animate-spin' : ''}`} /> Refresh now
          </button>
        </div>
      </section>

      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-xl px-4 py-3 text-sm ${notice.tone === 'error' ? 'bg-rose-400/15 text-rose-100' : 'bg-emerald-400/10 text-emerald-100'}`}>{notice.text}</p>}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-xl font-bold">Pictures</h2>
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 font-bold text-[#0b1120] hover:bg-cyan-200"><Plus className="h-4 w-4" /> Add picture</button>
      </div>

      {pictures.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-white/20 p-6 text-center text-slate-300">No pictures yet. Upload an image to the Cloudflare image bucket, then add its URL here.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {pictures.map((picture, index) => (
            <li key={picture.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#151f32] p-3 sm:flex-nowrap">
              <img src={picture.thumb_url ?? picture.url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <strong className="truncate">{picture.title}</strong>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[picture.status]}`}>{picture.status}</span>
                </div>
                <p className="truncate text-xs text-slate-400">{picture.theme} · {levelLabel(picture.min_challenge)} – {levelLabel(picture.max_challenge)}{picture.width ? ` · ${picture.width}×${picture.height}` : ''}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton label={`Move ${picture.title} up`} disabled={index === 0 || busy !== null} onClick={() => void move(index, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                <IconButton label={`Move ${picture.title} down`} disabled={index === pictures.length - 1 || busy !== null} onClick={() => void move(index, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                <IconButton label={`Preview ${picture.title} as a player`} onClick={() => setPreviewing(picture)}><Eye className="h-4 w-4" /></IconButton>
                <IconButton label={`Edit ${picture.title}`} disabled={busy !== null} onClick={() => setEditing(picture)}><Pencil className="h-4 w-4" /></IconButton>
                {picture.status === 'published'
                  ? <button type="button" disabled={busy !== null} onClick={() => void setPublished(picture, false)} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50">Unpublish</button>
                  : <button type="button" disabled={busy !== null} onClick={() => void setPublished(picture, true)} className="rounded-lg bg-emerald-400/20 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50">{busy === picture.id ? 'Checking…' : 'Publish'}</button>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <PictureEditor
          picture={editing === 'new' ? undefined : editing}
          themes={themes}
          onClose={() => setEditing(null)}
          onSaved={(message, catalog) => {
            setEditing(null);
            report(message, catalog);
            void refresh();
          }}
        />
      )}
      {previewing && <AdminPreview picture={previewing} onClose={() => setPreviewing(null)} />}
    </Shell>
  );
}

function Shell({ email, onSignOut, children }: { email?: string; onSignOut?: () => void; children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#0b1120] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-300"><Sparkles className="h-5 w-5" /> Shape Reveal admin</div>
          {email && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Signed in as {email}</span>
              {onSignOut && <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-200 hover:bg-white/10"><LogOut className="h-4 w-4" /> Sign out</button>}
            </div>
          )}
        </header>
        {children}
      </div>
    </main>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-lg p-2 text-slate-200 hover:bg-white/10 disabled:opacity-30">
      {children}
    </button>
  );
}
