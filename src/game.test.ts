import { describe, expect, it, vi } from "vitest";
import { createEngine, ConstantClock } from "@clockwyrks/simple-2d";
import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import { createCanvas } from "@napi-rs/canvas";
import { debug, game, type FacetState } from "./game";
import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  GRID_COLS,
  GRID_ROWS,
  SWAP_SECONDS,
  STAGE_W,
  STAGE_H,
  CUES,
} from "./constants";

const rows = [
  "R0 A0 C0 J0 B0 S0 M0 R0",
  "C0 J1 B0 S0 M0 R0 A0 C0",
  "B0 S0 M2 R1 A0 C0 J0 B0",
  "M0 R0 A0 C0 J0 B0b S0 M0",
  "A0 C0 J0 B0 S1 M0 R3 A0",
  "J0 B0 S2s M0 R0 A0 C0 J0",
  "S0 M0 R0 A0 X0 J0 B0 S0",
  "R0 A0 C0 J0 B0 S0 M0 R0",
];
const blank = () => debug.reset({ muted: false } as FacetState);
const api = {
  input: {
    pressed: () => false,
    pointerSamples: () => [],
    pointer: () => ({ x: 0, y: 0, down: false, device: "mouse" }),
  },
  audio: {
    play: vi.fn(),
    setMuted: vi.fn(),
    muted: () => false,
    looping: () => true,
    loop: vi.fn(),
    stop: vi.fn(),
  },
} as unknown as UpdateApi;
const tick = (s: FacetState, dt: number) => game.update(s, api, dt);

describe("Facet simulation", () => {
  it("deals boards with no opening runs and a legal swap", () => {
    for (let sample = 0; sample < 10; sample++) {
      const board = debug.snapshot(debug.dealBoard(blank()));
      expect(board.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
      expect(board.legalSwap).toBe(true);
      expect(
        board.board.cells.every(
          (g) => g.cut === "plain" && g.strain === 0 && g.fell >= g.row + 1,
        ),
      ).toBe(true);
      for (let r = 0; r < GRID_ROWS; r++)
        for (let c = 0; c < GRID_COLS; c++) {
          const a = board.board.cells[r * GRID_COLS + c];
          if (c < GRID_COLS - 2)
            expect(
              [
                a.kind,
                board.board.cells[r * GRID_COLS + c + 1].kind,
                board.board.cells[r * GRID_COLS + c + 2].kind,
              ].every((k) => k === a.kind),
            ).toBe(false);
          if (r < GRID_ROWS - 2)
            expect(
              [
                a.kind,
                board.board.cells[(r + 1) * GRID_COLS + c].kind,
                board.board.cells[(r + 2) * GRID_COLS + c].kind,
              ].every((k) => k === a.kind),
            ).toBe(false);
        }
    }
  });
  it("refuses a nonadjacent move without changing the board", () => {
    const s = debug.loadBoard(blank(), rows);
    const next = debug.requestSwap(s, 0, 0, 7, 7);
    expect(next.phase).toBe("idle");
    expect(next.board).toEqual(s.board);
    expect(next.refusal?.a).toEqual({ col: 0, row: 0 });
  });
  it("uses pointer selection and release to play an offered swap", () => {
    let s = debug.setScreen(debug.loadBoard(blank(), rows), "playing");
    const a = { col: 4, row: 6 },
      b = { col: 5, row: 6 };
    const x = (c: number) => BOARD_CX + (c - 3.5) * CELL_PITCH;
    const y = (r: number) => BOARD_CY + (r - 3.5) * CELL_PITCH;
    s = debug.pointerDown(s, x(a.col), y(a.row));
    expect(s.selection).toEqual(a);
    s = debug.pointerMove(s, x(b.col), y(b.row));
    expect(s.offer).toEqual(b);
    s = debug.pointerUp(s);
    expect(s.selection).toBeNull();
    expect(s.phase).toBe("swapping");
  });
  it("resolves a prism swap, scores, and preserves its chain timing", () => {
    let s = debug.setScreen(debug.loadBoard(blank(), rows), "playing");
    s = debug.requestSwap(s, 4, 6, 5, 6);
    expect(s.phase).toBe("swapping");
    s = tick(s, SWAP_SECONDS / 2);
    expect(s.phase).toBe("swapping");
    s = tick(s, SWAP_SECONDS / 2);
    expect(s.phase).toBe("resolving");
    expect(s.chainStep).toBe(1);
    expect(s.lastCleared).toBeGreaterThan(1);
    expect(s.score).toBe(s.lastPoints);
    expect(s.board.cells).toHaveLength(64);
    expect(s.board.cells.some((g) => g.fell > 0)).toBe(true);
  });
  it("poses token strain, cuts, and derives snapshot coordinates", () => {
    let s = debug.loadBoard(blank(), rows);
    s = debug.setGem(s, 0, 0, "M3s");
    const shot = debug.snapshot(s);
    expect(shot.board.cells[0]).toMatchObject({
      kind: "amethyst",
      cut: "star",
      strain: 3,
      fell: 0,
    });
    expect(shot.board.cells[0].x).toBe(BOARD_CX - 3.5 * CELL_PITCH);
    expect(shot.board.cells[0].y).toBe(BOARD_CY - 3.5 * CELL_PITCH);
    expect(() => debug.setGem(s, 0, 0, "Q1")).toThrow();
  });
  it("adds strain once around a clear and detonates a touched flawed gem", () => {
    const kinds = ["R", "A", "C", "J", "B", "S", "M"];
    const latin = Array.from({ length: GRID_ROWS }, (_, r) =>
      Array.from(
        { length: GRID_COLS },
        (_, c) => `${kinds[(r * 2 + c) % 7]}0`,
      ).join(" "),
    );
    let s = debug.setScreen(debug.loadBoard(blank(), latin), "playing");
    s = debug.setGem(s, 0, 0, "R0");
    s = debug.setGem(s, 1, 0, "A0");
    s = debug.setGem(s, 2, 0, "R0");
    s = debug.setGem(s, 1, 1, "R0");
    s = debug.setGem(s, 0, 1, "C3");
    s = debug.requestSwap(s, 1, 0, 1, 1);
    expect(s.phase).toBe("swapping");
    s = tick(s, SWAP_SECONDS);
    expect(s.lastCleared).toBeGreaterThanOrEqual(4);
    expect(s.lastPoints).toBeGreaterThanOrEqual(50);
    expect(s.lastWaves).toBeGreaterThanOrEqual(1);
  });
  it("clears every cell for two prisms and respects posed refill kinds", () => {
    let s = debug.setScreen(debug.loadBoard(blank(), rows), "playing");
    s = debug.setGem(s, 5, 6, "X0");
    for (let c = 0; c < GRID_COLS; c++)
      s = debug.setRefillKinds(s, c, "MMMMMMMM");
    s = debug.requestSwap(s, 4, 6, 5, 6);
    s = tick(s, SWAP_SECONDS);
    expect(s.lastCleared).toBe(64);
    expect(
      s.board.cells.every((g) => g.kind === "amethyst" && g.cut === "plain"),
    ).toBe(true);
  });
  it("advances the same state through the Simple 2D engine clock", async () => {
    const canvas = createCanvas(
      STAGE_W,
      STAGE_H,
    ) as unknown as HTMLCanvasElement;
    const surface = {
      cssWidth: () => STAGE_W,
      cssHeight: () => STAGE_H,
      dpr: () => 1,
      events: () => new EventTarget(),
    };
    const testGame: Game<FacetState, typeof debug> = {
      initialize(api) {
        for (const name of [
          ...Object.values(CUES),
          ...Array.from({ length: 8 }, (_, i) => `chain-${i + 1}`),
          "title-music",
          "play-music",
        ])
          api.audio.define(name, { freq: 440, durationMs: 50 });
        return [blank(), debug];
      },
      update: game.update,
      render: game.render,
    };
    const engine = createEngine({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game: testGame,
      surface,
      clock: new ConstantClock(16),
    });
    await engine.initialize();
    engine.apply((s) => engine.debug.loadBoard(s, rows));
    engine.apply((s) => engine.debug.setScreen(s, "playing"));
    engine.apply((s) => engine.debug.requestSwap(s, 4, 6, 5, 6));
    await engine.advance(12);
    const snap = engine.debug.snapshot(engine.state);
    expect(snap.phase).toBe("resolving");
    expect(snap.score).toBeGreaterThan(0);
    expect(snap.simTime).toBeCloseTo(0.192);
    engine.destroy();
  });
});
