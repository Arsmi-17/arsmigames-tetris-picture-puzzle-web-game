import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Flag, Heart, RotateCcw } from 'lucide-react';
import { HomeScreen } from '@/components/HomeScreen';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { WinScreen } from '@/components/WinScreen';
import { RoundIntro } from '@/components/RoundIntro';
import { ChapterProgress, ChapterRecap, RunOverScreen } from '@/components/RunScreens';
import { useGameEngine } from '@/useGameEngine';
import { CELEBRATION_MS, prefersReducedMotion } from '@/celebration';
import { MODES, rulesFor } from '@/challenge';
import { useCatalog } from '@/catalog';
import { preloadPicture } from '@/pictures';
import { randomSeed } from '@/random';
import { plural } from '@/format';
import * as runs from '@/run';
import { CHAPTER_LENGTH, type Challenge, type Picture, type RoundResult, type Run, type RunMode } from '@/model';
import type { GameConfig, GameState } from '@/types';

type Screen =
  | { name: 'home' }
  | { name: 'free-setup' }
  | { name: 'intro' }
  | { name: 'playing' }
  | { name: 'celebrating' }
  | { name: 'won' }
  | { name: 'chapter'; chapter: number; results: RoundResult[] }
  | { name: 'over'; reason: 'misses' | 'stopped' };

/** What the win screen needs about the round that just finished. */
interface Finished {
  state: GameState;
  outcome?: runs.RoundOutcome;
}

function App() {
  const catalog = useCatalog();
  const pictures = catalog.pictures;
  const pictureById = useMemo(() => new Map(pictures.map((p) => [p.id, p])), [pictures]);

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [run, setRun] = useState<Run | null>(null);
  const [savedRun, setSavedRun] = useState<Run | null>(() => runs.loadSavedRun());
  const [bests, setBests] = useState(() => runs.loadBests());
  const [improved, setImproved] = useState<string[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [exportable, setExportable] = useState(true);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [introKey, setIntroKey] = useState(0);

  const live = screen.name === 'playing' || screen.name === 'celebrating';
  const engine = useGameEngine(live ? config : null);

  /** Persist the run and keep personal bests current. */
  const commitRun = useCallback((next: Run) => {
    setRun(next);
    runs.saveRun(next);
    setSavedRun(next.ended ? null : next);
    setBests((current) => {
      const update = runs.updateBests(current, next);
      if (update.improved.length > 0) {
        runs.saveBests(update.bests);
        setImproved((prev) => [...new Set([...prev, ...update.improved])]);
      }
      return update.bests;
    });
  }, []);

  /** Build the round config for the run's current picture. */
  const roundFor = useCallback((current: Run): { run: Run; config: GameConfig } => {
    let next = current;
    if (!pictureById.has(next.pictureId)) next = runs.replacePicture(next, pictures);
    return {
      run: next,
      config: {
        picture: pictureById.get(next.pictureId)!,
        challenge: runs.runChallenge(next.challengeLevel, next.mode, next.chapter),
        rules: rulesFor(next.mode),
        seed: next.puzzleSeed,
      },
    };
  }, [pictureById, pictures]);

  const beginRound = useCallback((current: Run) => {
    const round = roundFor(current);
    if (round.run !== current) commitRun(round.run);
    else setRun(current);
    setConfig(round.config);
    setFinished(null);
    setIntroKey((k) => k + 1);
    setScreen({ name: 'intro' });
  }, [roundFor, commitRun]);

  const startRun = useCallback((mode: RunMode) => {
    const fresh = runs.createRun(mode, pictures);
    setImproved([]);
    commitRun(fresh);
    beginRound(fresh);
  }, [pictures, commitRun, beginRound]);

  const resumeRun = useCallback(() => {
    if (!savedRun) return;
    setImproved([]);
    beginRound(savedRun);
  }, [savedRun, beginRound]);

  const goHome = useCallback(() => {
    setConfig(null);
    setFinished(null);
    setRun(null);
    setSavedRun(runs.loadSavedRun());
    setScreen({ name: 'home' });
  }, []);

  const startFree = useCallback((picture: Picture, challenge: Challenge) => {
    setRun(null);
    setConfig({ picture, challenge, rules: rulesFor('free'), seed: randomSeed() });
    setFinished(null);
    setIntroKey((k) => k + 1);
    setScreen({ name: 'intro' });
  }, []);

  const handleReady = useCallback((canExport: boolean) => {
    setExportable(canExport);
    setScreen({ name: 'playing' });
  }, []);

  const skipPicture = useCallback(() => {
    if (!run) return;
    const next = runs.replacePicture(run, pictures);
    commitRun(next);
    beginRound(next);
  }, [run, pictures, commitRun, beginRound]);

  const endCurrentRun = useCallback((reason: 'misses' | 'stopped', current: Run | null = run) => {
    if (!current) return;
    commitRun(runs.endRun(current));
    setScreen({ name: 'over', reason });
  }, [run, commitRun]);

  // Arcade: each incorrect drop spends a miss straight away, so restarting a
  // picture cannot refund it.
  const seenMistakes = useRef(0);
  useEffect(() => { seenMistakes.current = 0; }, [config]);
  useEffect(() => {
    const mistakes = engine.state.mistakes;
    if (mistakes < seenMistakes.current) seenMistakes.current = mistakes;
    if (!run || run.mode !== 'arcade' || screen.name !== 'playing' || mistakes <= seenMistakes.current) return;
    let next = run;
    for (let i = seenMistakes.current; i < mistakes; i += 1) next = runs.recordMistake(next);
    seenMistakes.current = mistakes;
    commitRun(next);
    if (next.ended) setScreen({ name: 'over', reason: 'misses' });
  }, [engine.state.mistakes, run, screen.name, commitRun]);

  // Round won: record it, then play the completion sequence.
  useEffect(() => {
    if (screen.name !== 'playing' || !engine.state.won || !config) return;
    const state = engine.state;
    let outcome: runs.RoundOutcome | undefined;
    if (run) {
      const result: RoundResult = {
        pictureId: config.picture.id,
        level: run.challengeLevel,
        pieces: state.totalPieces,
        seconds: state.elapsed,
        mistakes: state.mistakes,
        hints: state.hintedPieceIds.size,
        score: state.score,
      };
      outcome = runs.completeRound(run, result, pictures);
      commitRun(outcome.run);
      preloadPicture(pictureById.get(outcome.run.pictureId)?.url);
    }
    setFinished({ state, outcome });
    setScreen({ name: 'celebrating' });
  }, [screen.name, engine.state, config, run, pictures, pictureById, commitRun]);

  useEffect(() => {
    if (screen.name !== 'celebrating') return;
    const timer = window.setTimeout(() => setScreen({ name: 'won' }), prefersReducedMotion() ? 0 : CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [screen.name]);

  const continueRun = useCallback(() => {
    if (!run || !finished?.outcome) return;
    if (finished.outcome.chapterComplete) {
      setScreen({ name: 'chapter', chapter: run.chapter - 1, results: finished.outcome.chapterResults });
    } else {
      beginRound(run);
    }
  }, [run, finished, beginRound]);

  // ---- Screens ----

  if (screen.name === 'home') {
    return <HomeScreen
      savedRun={savedRun}
      savedPictureTitle={savedRun ? pictureById.get(savedRun.pictureId)?.title : undefined}
      bests={bests}
      catalogLoading={catalog.loading}
      catalogSource={catalog.source}
      onStartRun={startRun}
      onResume={resumeRun}
      onFreePlay={() => setScreen({ name: 'free-setup' })}
    />;
  }

  if (screen.name === 'free-setup') {
    return <StartScreen key={catalog.version ?? catalog.source} pictures={pictures} onStart={startFree} onBack={goHome} />;
  }

  if (screen.name === 'chapter' && run) {
    return <ChapterRecap chapter={screen.chapter} results={screen.results} pictures={pictureById} run={run} improved={improved} onContinue={() => beginRound(run)} onHome={goHome} />;
  }

  if (screen.name === 'over' && run) {
    return <RunOverScreen run={run} improved={improved} reason={screen.reason} onNewRun={() => startRun(run.mode)} onHome={goHome} />;
  }

  if (!config) return <HomeLoading />;

  const runLabel = run ? `${MODES[run.mode].label} · Chapter ${run.chapter} · Picture ${run.stage + 1} of ${CHAPTER_LENGTH}` : undefined;

  if (screen.name === 'intro') {
    return <RoundIntro
      key={introKey}
      picture={config.picture}
      challenge={config.challenge}
      eyebrow={runLabel}
      onStart={handleReady}
      onSkip={run && pictures.length > 1 ? skipPicture : undefined}
      onBack={run ? goHome : () => setScreen({ name: 'free-setup' })}
      backLabel={run ? 'Save and exit' : 'Back'}
    />;
  }

  if (screen.name === 'won' && finished) {
    if (run && finished.outcome) {
      const { outcome } = finished;
      const clean = finished.state.mistakes === 0;
      const finishedStage = outcome.chapterComplete ? CHAPTER_LENGTH : run.stage;
      return <WinScreen
        config={config}
        state={finished.state}
        exportable={exportable}
        badge={`Chapter ${outcome.chapterComplete ? run.chapter - 1 : run.chapter} · Picture ${finishedStage} of ${CHAPTER_LENGTH}`}
        heading={clean ? 'Clean sweep!' : 'Picture perfect.'}
        message={run.mode === 'arcade'
          ? `+${(finished.state.score + outcome.bonus).toLocaleString()} points${outcome.bonus ? ` (including a ${outcome.bonus} completion bonus)` : ''}.`
          : 'Another picture for the album.'}
        details={
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#151f32] p-4 text-sm text-slate-300">
            <ChapterProgress stage={finishedStage} done={finishedStage} />
            <span>{run.mode === 'arcade' ? `Run: ${plural(run.score, 'point')} · ${plural(run.mistakesLeft, 'miss', 'misses')} left` : `${plural(run.picturesCompleted, 'picture')} this run`}{run.streak > 1 ? ` · ${run.streak} clean in a row` : ''}</span>
          </div>
        }
        primary={{
          label: outcome.chapterComplete ? 'Finish chapter' : 'Next picture',
          onClick: continueRun,
          icon: <ArrowRight className="h-5 w-5" />,
        }}
        secondary={[
          { label: 'End run', onClick: () => endCurrentRun('stopped'), icon: <Flag className="h-4 w-4" /> },
          { label: 'Save and exit', onClick: goHome },
        ]}
      />;
    }
    return <WinScreen
      config={config}
      state={finished.state}
      exportable={exportable}
      primary={{ label: 'Play again', onClick: () => startFree(config.picture, config.challenge), icon: <RotateCcw className="h-5 w-5" /> }}
      secondary={[{ label: 'New picture', onClick: () => setScreen({ name: 'free-setup' }) }, { label: 'Menu', onClick: goHome }]}
    />;
  }

  if (engine.state.board.length === 0) return <HomeLoading />;

  const missesLeft = run?.mode === 'arcade' ? run.mistakesLeft : null;
  return <GameScreen
    config={config}
    state={engine.state}
    celebrating={screen.name === 'celebrating'}
    subtitle={run ? `${config.picture.title} · Ch ${run.chapter} · ${run.stage + 1}/${CHAPTER_LENGTH}` : undefined}
    status={missesLeft !== null && (
      <div className="flex items-center gap-0.5" role="img" aria-label={`${plural(missesLeft, 'miss', 'misses')} left`} title={`${plural(missesLeft, 'miss', 'misses')} left`}>
        {Array.from({ length: MODES.arcade.mistakeBudget }, (_, i) => (
          <Heart key={i} aria-hidden="true" className={`h-4 w-4 ${i < missesLeft ? 'fill-rose-400 text-rose-400' : 'text-white/25'}`} />
        ))}
      </div>
    )}
    exitLabel={run ? 'Save and exit' : 'Menu'}
    onToggleHint={engine.toggleHint}
    onMoveLeft={engine.moveLeft}
    onMoveRight={engine.moveRight}
    onMoveDown={engine.moveDown}
    onHardDrop={engine.hardDrop}
    onPause={engine.pause}
    onResume={engine.resume}
    onReset={engine.reset}
    onHome={goHome}
  />;
}

function HomeLoading() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b1120] text-slate-300">Preparing puzzle…</div>;
}

export default App;
