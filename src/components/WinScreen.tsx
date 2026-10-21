import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Sparkles } from 'lucide-react';
import type { GameConfig, GameState } from '@/types';
import { formatTime } from '@/format';

export interface WinAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface WinScreenProps {
  config: GameConfig;
  state: GameState;
  /** False when the picture's host does not allow canvas export (CORS). */
  exportable: boolean;
  badge?: string;
  heading?: string;
  message?: string;
  /** Extra content under the stats, e.g. chapter progress. */
  details?: ReactNode;
  /** The one-tap way forward (Next picture, Play again). */
  primary: WinAction;
  secondary?: WinAction[];
}

async function makeResult(imageUrl: string, label: string, time: string, score: number): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The picture could not be loaded for download.'));
    image.src = imageUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1420;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable.');
  context.fillStyle = '#0b1120';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 40, 40, 1120, 1120);
  context.fillStyle = '#67e8f9';
  context.font = 'bold 30px system-ui';
  context.fillText('SHAPE REVEAL', 48, 1225);
  context.fillStyle = '#ffffff';
  context.font = 'bold 42px system-ui';
  context.fillText(label.slice(0, 28), 48, 1290);
  context.font = '32px system-ui';
  context.fillText(`Time ${time}   ·   Score ${score}`, 48, 1350);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the PNG.')), 'image/png'));
}

export function WinScreen({ config, state, exportable, badge = 'Puzzle complete', heading = 'Picture perfect.', message = 'You placed every shape and revealed the whole image.', details, primary, secondary = [] }: WinScreenProps) {
  const [status, setStatus] = useState('');
  const [downloading, setDownloading] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { picture } = config;
  const time = formatTime(state.elapsed);
  const filename = `shape-reveal-${picture.id}-${time.replace(':', '-')}.png`.replace(/[^a-z0-9.-]+/gi, '-');

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setStatus('Preparing your PNG…');
    try {
      const blob = await makeResult(picture.url, picture.title, time, state.score);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${filename} is ready in your browser downloads.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not download your picture.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#0b1120] px-4 py-6 text-white sm:px-6 sm:py-10" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
      <div className="mx-auto grid max-w-5xl gap-8 lg:min-h-[85dvh] lg:grid-cols-2 lg:items-center lg:gap-12">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#151f32] p-3 shadow-2xl sm:p-5">
          <img src={picture.url} alt={picture.alt || `Completed ${picture.title} picture`} className="aspect-square w-full rounded-2xl object-cover" />
          <div className="mt-4 flex items-center justify-between gap-3 px-1 text-sm text-slate-300"><span className="truncate">{picture.title}</span><span className="shrink-0">100% revealed</span></div>
          {picture.attribution && <p className="mt-1 px-1 text-xs text-slate-400">{picture.attribution}{picture.license ? ` · ${picture.license}` : ''}</p>}
        </div>
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" /> {badge}</div>
          <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">{heading}</h1>
          <p className="mt-4 max-w-md text-lg text-slate-300">{message}</p>
          <div className="mt-7 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-[#151f32] p-4"><span className="block text-xs text-slate-400">Time</span><strong className="mt-1 block text-2xl tabular-nums">{time}</strong></div>
            <div className="rounded-2xl bg-[#151f32] p-4"><span className="block text-xs text-slate-400">Score</span><strong className="mt-1 block text-2xl tabular-nums">{state.score}</strong></div>
            <div className="rounded-2xl bg-[#151f32] p-4"><span className="block text-xs text-slate-400">Misses</span><strong className="mt-1 block text-2xl tabular-nums">{state.mistakes}</strong></div>
          </div>
          {details}
          <button ref={primaryRef} type="button" onClick={primary.onClick} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 font-bold text-[#0b1120] hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">{primary.icon} {primary.label}</button>
          {exportable ? (
            <>
              <button type="button" onClick={() => void download()} disabled={downloading} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-medium hover:bg-white/20 disabled:opacity-50"><Download className="h-5 w-5" /> {downloading ? 'Preparing…' : 'Download completed picture'}</button>
              <p className="mt-2 text-xs text-slate-400">PNG file · your browser will save it or ask where to save.</p>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Download is unavailable for this picture because its image host does not allow it.</p>
          )}
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-cyan-200">{status}</p>
          {secondary.length > 0 && (
            <div className="mt-3 flex gap-3">
              {secondary.map((action) => (
                <button key={action.label} type="button" onClick={action.onClick} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 font-medium hover:bg-white/20">{action.icon} {action.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
