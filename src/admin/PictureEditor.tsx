import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { CHALLENGE_LADDER } from '@/challenge';
import { api, ApiError, toForm, toPayload, type AdminPicture, type ImageCheck, type ImageReport, type PictureForm, type PublishOutcome } from './api';

interface PictureEditorProps {
  picture?: AdminPicture;
  themes: string[];
  onClose: () => void;
  onSaved: (message: string, catalog?: PublishOutcome) => void;
}

type BrowserCheck = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok'; width: number; height: number } | { kind: 'error'; message: string };

/** Confirm this browser can load the image and export it from a canvas (CORS). */
function checkInBrowser(url: string): Promise<BrowserCheck> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        canvas.getContext('2d')?.drawImage(image, 0, 0, 8, 8);
        canvas.toDataURL();
        resolve({ kind: 'ok', width: image.naturalWidth, height: image.naturalHeight });
      } catch {
        resolve({ kind: 'error', message: 'The image loads but cannot be exported (CORS).' });
      }
    };
    image.onerror = () => resolve({ kind: 'error', message: 'This browser could not load the image. It may be missing, or the host may block cross-origin use (CORS).' });
    image.src = url;
  });
}

function CheckList({ title, check }: { title: string; check: ImageCheck }) {
  return (
    <div className="rounded-xl bg-black/20 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-rose-300" />}
        {title}{check.width ? ` · ${check.width}×${check.height}` : ''}{check.bytes ? ` · ${Math.round(check.bytes / 1024)} KB` : ''}
      </p>
      {check.errors.map((e) => <p key={e} className="mt-1 text-rose-200">{e}</p>)}
      {check.warnings.map((w) => <p key={w} className="mt-1 text-amber-200">{w}</p>)}
    </div>
  );
}

export function PictureEditor({ picture, themes, onClose, onSaved }: PictureEditorProps) {
  const [form, setForm] = useState<PictureForm>(() => toForm(picture));
  const [report, setReport] = useState<ImageReport | null>(null);
  const [browser, setBrowser] = useState<BrowserCheck>({ kind: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const formId = useId();

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = <K extends keyof PictureForm>(key: K, value: PictureForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'url' || key === 'thumbUrl') {
      setReport(null);
      setBrowser({ kind: 'idle' });
    }
  };

  const runChecks = async () => {
    if (!form.url.trim()) return;
    setChecking(true);
    setBrowser({ kind: 'checking' });
    try {
      const [server, local] = await Promise.all([
        api<ImageReport>('/api/admin/check-image', { method: 'POST', body: { url: form.url.trim(), thumbUrl: form.thumbUrl.trim() || undefined, id: picture?.id } }),
        checkInBrowser(form.url.trim()),
      ]);
      setReport(server);
      setBrowser(local);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The image check failed.']);
      setBrowser({ kind: 'idle' });
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const body = toPayload(form);
      const result = picture
        ? await api<{ catalog?: PublishOutcome }>(`/api/admin/pictures/${picture.id}`, { method: 'PUT', body })
        : await api<{ catalog?: PublishOutcome }>('/api/admin/pictures', { method: 'POST', body });
      onSaved(picture ? `${body.title} saved` : `${body.title} added as a draft`, result.catalog);
    } catch (error) {
      if (error instanceof ApiError) {
        if (Array.isArray(error.body.errors)) setErrors(error.body.errors as string[]);
        else setErrors([error.message]);
        if (error.body.report) setReport(error.body.report as ImageReport);
      } else {
        setErrors(['Could not save. Check your connection and try again.']);
      }
    } finally {
      setSaving(false);
    }
  };

  const input = 'mt-1 w-full rounded-xl border border-white/15 bg-[#0b1120] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none';
  const label = 'block text-sm font-medium text-slate-200';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0b1120]/90 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`} className="my-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-[#151f32] p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-between">
          <h2 id={`${formId}-title`} className="text-xl font-bold">{picture ? `Edit ${picture.title}` : 'Add a picture'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        {picture?.status === 'published' && <p className="mt-2 text-sm text-amber-200">This picture is live. Saving updates the public catalog.</p>}

        <form className="mt-5 grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className={label}>Image URL
              <input ref={firstField} className={input} type="url" required inputMode="url" placeholder="https://images.example.com/pictures/lake-v1.jpg" value={form.url} onChange={(e) => update('url', e.target.value)} />
            </label>
            <button type="button" onClick={() => void runChecks()} disabled={!form.url.trim() || checking} className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50">{checking ? 'Checking…' : 'Check image'}</button>
          </div>
          <label className={label}>Thumbnail URL <span className="font-normal text-slate-400">(optional)</span>
            <input className={input} type="url" inputMode="url" value={form.thumbUrl} onChange={(e) => update('thumbUrl', e.target.value)} />
          </label>

          {(report || browser.kind !== 'idle') && (
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="aspect-square overflow-hidden rounded-xl bg-black/30">
                {browser.kind === 'ok' && <img src={form.url} alt="Preview" className="h-full w-full object-cover" />}
              </div>
              <div className="grid gap-2">
                {report && <CheckList title="Image (server check)" check={report.image} />}
                {report?.thumb && <CheckList title="Thumbnail" check={report.thumb} />}
                {browser.kind === 'ok' && <p className="text-sm text-emerald-200">This browser can load and export the image ({browser.width}×{browser.height}).</p>}
                {browser.kind === 'error' && <p className="text-sm text-rose-200">{browser.message}</p>}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Title
              <input className={input} required maxLength={80} value={form.title} onChange={(e) => update('title', e.target.value)} />
            </label>
            <label className={label}>Theme
              <input className={input} required maxLength={40} list={`${formId}-themes`} placeholder="Calm, Bright, Dramatic…" value={form.theme} onChange={(e) => update('theme', e.target.value)} />
              <datalist id={`${formId}-themes`}>{themes.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
          </div>
          <label className={label}>Alt text <span className="font-normal text-slate-400">(describe the picture)</span>
            <textarea className={input} required maxLength={300} rows={2} value={form.alt} onChange={(e) => update('alt', e.target.value)} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Attribution
              <input className={input} maxLength={200} placeholder="Photo by …" value={form.attribution} onChange={(e) => update('attribution', e.target.value)} />
            </label>
            <label className={label}>License
              <input className={input} maxLength={80} placeholder="CC BY 4.0, owned, …" value={form.license} onChange={(e) => update('license', e.target.value)} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Easiest challenge
              <select className={input} value={form.minChallenge} onChange={(e) => update('minChallenge', Number(e.target.value))}>
                {CHALLENGE_LADDER.map((c) => <option key={c.level} value={c.level}>{c.level} · {c.label}</option>)}
              </select>
            </label>
            <label className={label}>Hardest challenge
              <select className={input} value={form.maxChallenge} onChange={(e) => update('maxChallenge', Number(e.target.value))}>
                {CHALLENGE_LADDER.map((c) => <option key={c.level} value={c.level}>{c.level} · {c.label}</option>)}
              </select>
            </label>
          </div>

          {errors.length > 0 && (
            <div role="alert" className="rounded-xl bg-rose-400/15 p-3 text-sm text-rose-100">
              {errors.map((e) => <p key={e}>{e}</p>)}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-3 text-sm hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-[#0b1120] hover:bg-cyan-200 disabled:opacity-50">{saving ? 'Saving…' : picture ? 'Save changes' : 'Save as draft'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
