const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gameLogic.ts'), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const gameModule = { exports: {} };
new Function('module', 'exports', javascript)(gameModule, gameModule.exports);
const game = gameModule.exports;

for (const size of [4, 8, 10]) {
  for (let trial = 0; trial < 50; trial += 1) {
    const parts = game.partitionGrid(size, size);
    const pieces = game.createPiecesFromPartitions(parts);
    const order = game.orderPiecesForSupportedPlacement(pieces, parts, size);
    const coverage = Array(size * size).fill(0);

    assert.equal(parts.length, size * size / 4);
    assert.equal(order.length, pieces.length, 'every piece needs a playable order');
    for (const part of parts) {
      assert.equal(part.cells.length, 4, 'every shape needs four cells');
      for (const cell of part.cells) {
        const x = part.originCol + cell.x;
        const y = part.originRow + cell.y;
        assert.ok(x >= 0 && x < size && y >= 0 && y < size);
        coverage[y * size + x] += 1;
      }
    }
    assert.ok(coverage.every((count) => count === 1), 'picture must be tiled exactly once');

    const board = game.createEmptyBoard(size, size);
    for (const piece of order) {
      const target = parts[piece.id];
      const falling = { ...piece, col: target.originCol, row: -game.SPAWN_ROWS };
      while (game.canPlaceOnBoard({ ...falling, row: falling.row + 1 }, board, size, size)) {
        falling.row += 1;
      }
      assert.equal(falling.row, target.originRow, 'piece must fall to its target without obstruction');
      game.placeOnBoard(falling, board);
    }
    assert.ok(board.every((row) => row.every((cell) => cell !== null)));
  }
  process.stdout.write(`${size}x${size}: 50 playable picture boards\n`);
}
