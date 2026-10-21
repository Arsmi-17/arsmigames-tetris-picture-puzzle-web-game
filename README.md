# Shape Reveal

A picture puzzle played with falling Tetris shapes. Each piece carries the exact part of the picture that belongs on the board. Guide it into place; correct drops lock and reveal the image, while wrong drops reappear in a safe retry order.

## Run locally

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm run build`, `npm run typecheck`, and `npm run lint` check the production bundle and source.

## How to play

1. Choose Aurora Lake, Sunset Cove, or an image from your device. Uploaded images are cropped to a square in the browser and are never sent to a server.
2. Choose Easy (4 shapes), Medium (16 shapes), or Hard (25 shapes).
3. Move each falling piece with Left and Right. Down advances it one cell; Space drops it to the lowest available position. Touch controls provide the same actions.
4. Match the image fragment to its place on the board. The Hint control outlines the current piece's target. Correct pieces lock; wrong pieces are retried without making the remaining puzzle impossible.
5. Complete the picture to see your time and score, download a PNG, or play again.

Pause with the on-screen button or **P**. Restart and Menu are in the pause panel. There is no rotation; each image slice keeps the orientation that fits the picture.

## Game design

- Every board is tiled with the seven standard four-cell Tetris shapes. Larger boards are built from small tilings so generation stays quick.
- A piece queue is accepted only when its target positions have support and a clear vertical path. Rejected-piece retries simulate the full remaining queue before changing its order.
- Score is 100 per correct piece, with 25 removed for an incorrect drop. The timer pauses with the game.
- The picture and result PNG are generated locally. The app has no cloud requests, accounts, or persistent progress.

## Next production steps

Add curated image packs with clear usage rights, audio and feedback settings, keyboard focus and screen-reader playtesting, then tune each difficulty with players. If persistent progress becomes useful later, decide the account and privacy model before adding a backend.
