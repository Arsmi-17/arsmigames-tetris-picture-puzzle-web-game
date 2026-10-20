/**
 * Renders the finish poster: a single, self-contained PNG holding the revealed
 * picture, the sign-off copy and the finish time — everything the player needs
 * to share in one attachment.
 */

const POSTER_SIZE = 1600;

/** Picture geometry. The photo is centred horizontally and drawn whole. */
const IMAGE_TOP = 64;
const IMAGE_SIDE_PAD = 210;
const IMAGE_RADIUS = 18;

/** Palette, matching the brand tokens in tailwind.config.js. */
const SKY = '#D7E8F9';
const BLUE = '#236DFF';
const INK = '#0C1220';
const MUTED = '#5B6066';

const DISPLAY = '"Tally Display", "Tally", system-ui, sans-serif';
const BODY = '"Tally", system-ui, sans-serif';

export interface PosterOptions {
  imageUrl: string;
  imageLabel: string;
  /** Formatted finish time, e.g. "0:58". */
  time: string;
  /** Headline under the picture. */
  headline?: string;
  /** Supporting line(s) under the headline. */
  subhead?: string[];
}

function loadImage(url: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load poster image: ${label}`));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not generate PNG poster.'));
    }, 'image/png');
  });
}

/** roundRect is recent enough that a manual fallback is still worth keeping. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Outline clock, drawn to match the lucide icon used on screen. */
function drawClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.17);
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - r * 0.55);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.45, cy + r * 0.28);
  ctx.stroke();
  ctx.restore();
}

/**
 * Makes sure the Tally faces are rasterised before we measure or paint text.
 * Without this the first poster of a session can fall back to a system font.
 */
async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 58px ${DISPLAY}`),
    document.fonts.load(`700 150px ${DISPLAY}`),
    document.fonts.load(`400 46px ${BODY}`),
    document.fonts.load(`700 38px ${BODY}`),
  ]).catch(() => undefined);
  await document.fonts.ready;
}

export async function generateFinishPoster({
  imageUrl,
  imageLabel,
  time,
  headline = 'The Next level?',
  subhead = ['That’s going to be', 'game-changing.'],
}: PosterOptions): Promise<Blob> {
  await ensureFonts();

  const image = await loadImage(imageUrl, imageLabel);
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_SIZE;
  canvas.height = POSTER_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Poster canvas is not available.');

  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, POSTER_SIZE, POSTER_SIZE);

  // ---- Picture, drawn whole ----
  const frameLeft = IMAGE_SIDE_PAD;
  const frameWidth = POSTER_SIZE - IMAGE_SIDE_PAD * 2;
  const frameRight = frameLeft + frameWidth;
  const frameBottom = IMAGE_TOP + frameWidth;

  ctx.save();
  roundedPath(ctx, frameLeft, IMAGE_TOP, frameWidth, frameWidth, IMAGE_RADIUS);
  ctx.clip();

  // Cover-fit so the photo fills the square frame without distortion.
  const scale = Math.max(frameWidth / image.width, frameWidth / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  ctx.drawImage(
    image,
    frameLeft + (frameWidth - drawW) / 2,
    IMAGE_TOP + (frameWidth - drawH) / 2,
    drawW,
    drawH,
  );
  ctx.restore();

  // ---- Copy block ----
  ctx.textBaseline = 'alphabetic';
  const copyTop = frameBottom + 56;

  ctx.fillStyle = BLUE;
  roundedPath(ctx, frameLeft, copyTop, 100, 9, 4.5);
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.font = `700 58px ${DISPLAY}`;
  ctx.fillText(headline, frameLeft, copyTop + 95);

  ctx.fillStyle = MUTED;
  ctx.font = `400 46px ${BODY}`;
  subhead.forEach((line, i) => {
    ctx.fillText(line, frameLeft, copyTop + 170 + i * 60);
  });

  // ---- Time block, right-aligned to the picture's edge ----
  ctx.font = `700 150px ${DISPLAY}`;
  const timeWidth = ctx.measureText(time).width;
  const timeLeft = frameRight - timeWidth;

  ctx.fillStyle = INK;
  ctx.fillText(time, timeLeft, copyTop + 182);

  const labelBaseline = copyTop + 36;
  const clockR = 21;
  drawClock(ctx, timeLeft + clockR, labelBaseline - 11, clockR);

  ctx.font = `700 38px ${BODY}`;
  ctx.letterSpacing = '10px';
  ctx.fillText('TIME', timeLeft + clockR * 2 + 18, labelBaseline);
  ctx.letterSpacing = '0px';

  return canvasToBlob(canvas);
}
