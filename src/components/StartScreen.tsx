import { useState } from 'react';
import { ArrowRight, ImagePlus, Sparkles } from 'lucide-react';
import { DIFFICULTIES, PUZZLE_IMAGES } from '@/gameLogic';
import type { DifficultyId, GameConfig, ImageOption } from '@/types';

interface StartScreenProps { onStart: (config: GameConfig) => void }

async function squareImage(file: File): Promise<string> {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 1024, 1024);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function StartScreen({ onStart }: StartScreenProps) {
  const [image, setImage] = useState<ImageOption>(PUZZLE_IMAGES[0]);
  const [difficulty, setDifficulty] = useState<DifficultyId>('medium');
  const [imageError, setImageError] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);

  const handleImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setImageError('Choose an image file.'); return; }
    if (file.size > 8 * 1024 * 1024) { setImageError('Choose an image smaller than 8 MB.'); return; }
    setImageError('');
    setLoadingImage(true);
    try {
      setImage({ id: 'custom', label: file.name, url: await squareImage(file) });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not open image.');
    } finally {
      setLoadingImage(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#0b1120] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-300"><Sparkles className="h-5 w-5" /> Shape Reveal</div>
          <span className="text-xs text-slate-400">Picture puzzle + falling blocks</span>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1fr_1.08fr] lg:items-center">
          <section>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Make the picture whole</p>
            <h1 className="max-w-xl text-4xl font-black leading-tight tracking-tight sm:text-6xl">Every block holds <span className="text-cyan-300">a piece of the picture.</span></h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg">Guide falling Tetris shapes into their matching spaces. Each correct drop reveals more of the image.</p>
            <div className="mt-7 grid max-w-lg grid-cols-3 gap-2 text-center text-xs text-slate-300 sm:text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Move<br /><strong className="text-white">← →</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Soft drop<br /><strong className="text-white">↓</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Instant drop<br /><strong className="text-white">Space</strong></div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#151f32] p-5 shadow-2xl sm:p-7" aria-label="Game setup">
            <h2 className="text-xl font-bold">Choose a picture</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {PUZZLE_IMAGES.map((option) => (
                <button key={option.id} type="button" onClick={() => setImage(option)} aria-pressed={image.id === option.id}
                  className={`overflow-hidden rounded-xl border-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${image.id === option.id ? 'border-cyan-300' : 'border-transparent hover:border-white/40'}`}>
                  <img src={option.url} alt="" className="aspect-square w-full object-cover" />
                  <span className="block truncate bg-[#25334a] px-2 py-2 text-xs font-medium">{option.label}</span>
                </button>
              ))}
              <label className={`cursor-pointer overflow-hidden rounded-xl border-2 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-300 ${image.id === 'custom' ? 'border-cyan-300' : 'border-dashed border-white/30 hover:border-white/60'}`}>
                <span className="flex aspect-square items-center justify-center bg-[#25334a]">{image.id === 'custom' ? <img src={image.url} alt="Your picture" className="h-full w-full object-cover" /> : <ImagePlus className="h-7 w-7 text-cyan-300" />}</span>
                <span className="block truncate bg-[#25334a] px-2 py-2 text-xs font-medium">{loadingImage ? 'Loading…' : image.id === 'custom' ? image.label : 'Your image'}</span>
                <input className="sr-only" type="file" accept="image/*" onChange={(event) => void handleImage(event.target.files?.[0])} />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-400">Your image stays in this browser session.</p>
            {imageError && <p role="alert" className="mt-2 text-sm text-rose-300">{imageError}</p>}

            <h2 className="mt-7 text-xl font-bold">Choose a challenge</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(Object.keys(DIFFICULTIES) as DifficultyId[]).map((id) => (
                <button key={id} type="button" onClick={() => setDifficulty(id)} aria-pressed={difficulty === id}
                  className={`rounded-xl border px-3 py-3 text-left transition ${difficulty === id ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <strong className="block text-sm">{DIFFICULTIES[id].label}</strong>
                  <span className="mt-1 block text-xs leading-snug text-slate-300">{DIFFICULTIES[id].description}</span>
                </button>
              ))}
            </div>

            <button type="button" onClick={() => onStart({ image, difficulty: DIFFICULTIES[difficulty] })} disabled={loadingImage}
              className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-cyan-300 px-6 py-4 font-bold text-[#0b1120] transition hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">
              Start puzzle <ArrowRight className="h-5 w-5" />
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
