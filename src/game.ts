import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { ParticleCanvasPlayer } from "@clockwyrks/particle-runtime/canvas";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import * as K from "./constants";

export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";
export type Cut = "plain" | "brilliant" | "star" | "prism";
export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";
export type Phase = "idle" | "swapping" | "resolving";
export type PointerDevice = "mouse" | "pen" | "touch";
export interface CellRef {
  readonly col: number;
  readonly row: number;
}
export interface GemState {
  readonly col: number;
  readonly row: number;
  readonly kind: GemKind | null;
  readonly cut: Cut;
  readonly strain: number;
  readonly fell: number;
}
export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly GemState[];
}
export interface RefusalState {
  readonly a: CellRef;
  readonly b: CellRef;
  readonly timer: number;
}
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}
export interface FacetState {
  readonly screen: Screen;
  readonly menuIndex: number;
  readonly board: BoardState;
  readonly phase: Phase;
  readonly chainStep: number;
  readonly swapTimer: number;
  readonly stepTimer: number;
  readonly score: number;
  readonly level: number;
  readonly levelScore: number;
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;
  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;
  readonly selection: CellRef | null;
  readonly offer: CellRef | null;
  readonly refusal: RefusalState | null;
  readonly armedTarget: string | null;
  readonly pointer: PointerState;
  readonly simTime: number;
  readonly muted: boolean;
  readonly refillKinds: readonly string[];
  readonly swapPair?: readonly [CellRef, CellRef] | null;
  readonly prismSeed?: GemKind | "all" | null;
  readonly clearVisual?: readonly { gem: GemState; wave: number }[];
  readonly cutVisual?: readonly CellRef[];
  readonly dealTimer?: number | null;
}
export const BACKGROUND = "#081321";
const letters = "RACJBSM";
const emptyBoard: BoardState = { cols: 0, rows: 0, cells: [] };
const idx = (c: number, r: number) => r * K.GRID_COLS + c;
const valid = (c: number, r: number) =>
  c >= 0 && c < K.GRID_COLS && r >= 0 && r < K.GRID_ROWS;
const ref = (c: number, r: number): CellRef => ({ col: c, row: r });
const xOf = (c: number) =>
  K.BOARD_CX + (c - (K.GRID_COLS - 1) / 2) * K.CELL_PITCH;
const yOf = (r: number) =>
  K.BOARD_CY + (r - (K.GRID_ROWS - 1) / 2) * K.CELL_PITCH;
const same = (a: CellRef | null, b: CellRef | null) =>
  !!a && !!b && a.col === b.col && a.row === b.row;
const adjacent = (a: CellRef, b: CellRef) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
const cell = (b: BoardState, c: number, r: number) => b.cells[idx(c, r)];
const cloneGem = (
  g: GemState,
  c: number,
  r: number,
  fell = g.fell,
): GemState => ({ ...g, col: c, row: r, fell });
const randomKind = (): GemKind =>
  K.GEM_KINDS[Math.floor(Math.random() * K.GEM_KIND_COUNT)];
const gem = (
  c: number,
  r: number,
  kind: GemKind | null,
  cut: Cut = "plain",
  strain = 0,
  fell = 0,
): GemState => ({ col: c, row: r, kind, cut, strain, fell });
const boardOf = (cells: readonly GemState[]): BoardState => ({
  cols: K.GRID_COLS,
  rows: K.GRID_ROWS,
  cells,
});
function runs(b: BoardState): number[][] {
  if (!b.cells.length) return [];
  const found: number[][] = [];
  for (let axis = 0; axis < 2; axis++)
    for (let outer = 0; outer < K.GRID_ROWS; outer++) {
      let i = 0;
      while (i < K.GRID_COLS) {
        const at = (n: number) => (axis === 0 ? idx(n, outer) : idx(outer, n));
        const kind = b.cells[at(i)].kind;
        let end = i + 1;
        while (kind && end < K.GRID_COLS && b.cells[at(end)].kind === kind)
          end++;
        if (kind && end - i >= K.MATCH_MIN)
          found.push(Array.from({ length: end - i }, (_, j) => at(i + j)));
        i = end;
      }
    }
  return found;
}
function exchanged(b: BoardState, a: CellRef, z: CellRef): BoardState {
  const cells = [...b.cells],
    ai = idx(a.col, a.row),
    zi = idx(z.col, z.row);
  cells[ai] = cloneGem(b.cells[zi], a.col, a.row, 0);
  cells[zi] = cloneGem(b.cells[ai], z.col, z.row, 0);
  return boardOf(cells);
}
function productive(b: BoardState, a: CellRef, z: CellRef): boolean {
  return (
    valid(a.col, a.row) &&
    valid(z.col, z.row) &&
    adjacent(a, z) &&
    (cell(b, a.col, a.row).cut === "prism" ||
      cell(b, z.col, z.row).cut === "prism" ||
      runs(exchanged(b, a, z)).length > 0)
  );
}
function legalSwap(b: BoardState): boolean {
  if (!b.cells.length) return false;
  for (let r = 0; r < K.GRID_ROWS; r++)
    for (let c = 0; c < K.GRID_COLS; c++)
      for (const [dc, dr] of [
        [1, 0],
        [0, 1],
      ]) {
        const z = ref(c + dc, r + dr);
        if (valid(z.col, z.row) && productive(b, ref(c, r), z)) return true;
      }
  return false;
}
function opening(): BoardState {
  for (let attempt = 0; attempt < 100; attempt++) {
    const cells: GemState[] = [];
    for (let r = 0; r < K.GRID_ROWS; r++)
      for (let c = 0; c < K.GRID_COLS; c++) {
        let choices = [...K.GEM_KINDS] as GemKind[];
        if (c > 1 && cells[idx(c - 1, r)].kind === cells[idx(c - 2, r)].kind)
          choices = choices.filter((k) => k !== cells[idx(c - 1, r)].kind);
        if (r > 1 && cells[idx(c, r - 1)].kind === cells[idx(c, r - 2)].kind)
          choices = choices.filter((k) => k !== cells[idx(c, r - 1)].kind);
        cells.push(
          gem(
            c,
            r,
            choices[Math.floor(Math.random() * choices.length)],
            "plain",
            0,
            r + 1,
          ),
        );
      }
    const b = boardOf(cells);
    if (legalSwap(b)) return b;
  }
  throw new Error("Could not deal a playable board");
}
function initial(muted = false): FacetState {
  return {
    screen: "title",
    menuIndex: 0,
    board: emptyBoard,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    score: 0,
    level: 1,
    levelScore: 0,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    pointer: { x: 0, y: 0, down: false, device: "mouse" },
    simTime: 0,
    muted,
    refillKinds: Array(K.GRID_COLS).fill(""),
    swapPair: null,
    prismSeed: null,
    clearVisual: [],
    cutVisual: [],
    dealTimer: null,
  };
}
function request(
  s: DeepReadonly<FacetState>,
  a: CellRef,
  z: CellRef,
): FacetState {
  if (
    !s.board.cells.length ||
    s.phase !== "idle" ||
    !productive(s.board as BoardState, a, z)
  )
    return { ...s, refusal: { a, b: z, timer: 0 } } as FacetState;
  const ga = cell(s.board as BoardState, a.col, a.row),
    gz = cell(s.board as BoardState, z.col, z.row);
  const prismSeed =
    ga.cut === "prism" || gz.cut === "prism"
      ? ga.cut === "prism" && gz.cut === "prism"
        ? "all"
        : ga.cut === "prism"
          ? gz.kind
          : ga.kind
      : null;
  return {
    ...s,
    board: exchanged(s.board as BoardState, a, z),
    phase: "swapping",
    swapTimer: 0,
    stepTimer: 0,
    chainStep: 0,
    moveScore: 0,
    refusal: null,
    swapPair: [a, z],
    prismSeed,
    clearVisual: [],
    cutVisual: [],
    dealTimer: null,
  } as FacetState;
}
interface StepEvent {
  clear: boolean;
  flaw: boolean;
  cut: boolean;
  land: boolean;
}
function resolveStep(s: FacetState): { state: FacetState; event: StepEvent } {
  const b = s.board,
    sourceRuns = s.chainStep === 1 && s.prismSeed ? [] : runs(b);
  const seeds = new Set<number>(sourceRuns.flat());
  if (s.chainStep === 1 && s.prismSeed) {
    b.cells.forEach((g, i) => {
      if (s.prismSeed === "all" || g.cut === "prism" || g.kind === s.prismSeed)
        seeds.add(i);
    });
  }
  const waves = new Map<number, number>();
  const queue: number[] = [];
  for (const i of seeds) {
    waves.set(i, 0);
    queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      g = b.cells[i],
      w = waves.get(i)! + 1,
      c = g.col,
      r = g.row;
    const add = (cc: number, rr: number) => {
      if (valid(cc, rr)) {
        const j = idx(cc, rr);
        if (!waves.has(j)) {
          waves.set(j, w);
          queue.push(j);
        }
      }
    };
    if (g.cut === "brilliant")
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) add(c + dx, r + dy);
    if (g.cut === "star") {
      for (let n = 0; n < K.GRID_COLS; n++) {
        add(n, r);
        add(c, n);
      }
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (
        valid(c + dx, r + dy) &&
        cell(b, c + dx, r + dy).strain === K.MAX_STRAIN
      )
        add(c + dx, r + dy);
  }
  const clear = new Set(waves.keys());
  let flaw = false;
  const strained = b.cells.map((g, i) => {
    if (clear.has(i)) return g;
    const near = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(
      ([dx, dy]) =>
        valid(g.col + dx, g.row + dy) && clear.has(idx(g.col + dx, g.row + dy)),
    );
    const strain = near ? Math.min(K.MAX_STRAIN, g.strain + 1) : g.strain;
    if (strain === K.MAX_STRAIN && g.strain < K.MAX_STRAIN) flaw = true;
    return { ...g, strain };
  });
  const created = new Map<number, Cut>();
  const priority = (cut: Cut) =>
    cut === "prism" ? 3 : cut === "star" ? 2 : cut === "brilliant" ? 1 : 0;
  const put = (i: number, cut: Cut) => {
    if (!created.has(i) || priority(cut) > priority(created.get(i)!))
      created.set(i, cut);
  };
  for (const run of sourceRuns) {
    const cut: Cut =
      run.length >= 5 ? "prism" : run.length === 4 ? "brilliant" : "plain";
    if (cut !== "plain") {
      const pair = s.swapPair ?? [];
      const hits = pair
        .map((p) => run.indexOf(idx(p.col, p.row)))
        .filter((v) => v >= 0);
      put(
        run[hits.length ? Math.min(...hits) : Math.floor((run.length - 1) / 2)],
        cut,
      );
    }
  }
  for (let i = 0; i < b.cells.length; i++)
    if (sourceRuns.filter((run) => run.includes(i)).length > 1) put(i, "star");
  const placed: (GemState | null)[] = b.cells.map((_, i) =>
    clear.has(i) ? null : strained[i],
  );
  for (const [i, cut] of created) {
    const old = b.cells[i];
    placed[i] = gem(old.col, old.row, cut === "prism" ? null : old.kind, cut);
  }
  const cells: (GemState | undefined)[] = Array(b.cells.length);
  for (let c = 0; c < K.GRID_COLS; c++) {
    const survivors: GemState[] = [];
    for (let r = K.GRID_ROWS - 1; r >= 0; r--) {
      const g = placed[idx(c, r)];
      if (g) survivors.push(g);
    }
    let cursor = K.GRID_ROWS - 1;
    for (const g of survivors) {
      cells[idx(c, cursor)] = cloneGem(g, c, cursor, cursor - g.row);
      cursor--;
    }
    while (cursor >= 0) {
      const letter = s.refillKinds[c]?.[cursor],
        li = letters.indexOf(letter ?? "");
      const kind = li < 0 ? randomKind() : K.GEM_KINDS[li];
      cells[idx(c, cursor)] = gem(c, cursor, kind, "plain", 0, cursor + 1);
      cursor--;
    }
  }
  const newBoard = boardOf(cells as GemState[]);
  const points = [...clear].reduce(
    (n, i) =>
      n +
      (b.cells[i].strain === K.MAX_STRAIN ? K.FLAWED_SCORE : K.BASE_SCORE) *
        Math.min(s.chainStep, K.MAX_MULTIPLIER),
    0,
  );
  const visual = [...waves].map(([i, wave]) => ({ gem: b.cells[i], wave }));
  const state: FacetState = {
    ...s,
    board: newBoard,
    phase: "resolving",
    stepTimer: 0,
    lastCleared: clear.size,
    lastPoints: points,
    lastWaves: Math.max(0, ...waves.values()),
    score: s.score + points,
    levelScore: s.levelScore + points,
    moveScore: s.moveScore + points,
    bestChain: Math.max(s.bestChain, s.chainStep),
    clearVisual: visual,
    cutVisual: [...created.keys()].map((i) =>
      ref(b.cells[i].col, b.cells[i].row),
    ),
  };
  return {
    state,
    event: {
      clear: clear.size > 0,
      flaw,
      cut: created.size > 0,
      land: Math.max(...newBoard.cells.map((g) => g.fell)) > K.LAND_MIN_ROWS,
    },
  };
}
function stepHold(s: DeepReadonly<FacetState>) {
  return (
    s.lastWaves * K.WAVE_SECONDS +
    Math.max(0, ...s.board.cells.map((g) => g.fell)) * K.FALL_SECONDS_PER_ROW +
    K.STEP_SECONDS
  );
}
const targetRows = (screen: Screen) =>
  screen === "title"
    ? K.TITLE_ITEMS
    : screen === "paused"
      ? K.PAUSED_ITEMS
      : screen === "levelclear"
        ? K.LEVELCLEAR_ITEMS
        : screen === "gameover"
          ? K.GAMEOVER_ITEMS
          : [];
export interface Target {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
function targets(screen: Screen): Target[] {
  if (screen === "playing")
    return [{ id: "pause", x: 1080, y: 28, w: 152, h: 72 }];
  if (screen === "howto") return [{ id: "back", x: 48, y: 28, w: 152, h: 72 }];
  return targetRows(screen).map((_, i) => ({
    id: `menu-${i}`,
    x: 490,
    y: screen === "title" ? 420 + i * 94 : 440 + i * 94,
    w: 300,
    h: 78,
  }));
}
function hitTarget(screen: Screen, x: number, y: number) {
  return (
    targets(screen).find(
      (t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h,
    )?.id ?? null
  );
}
function hitCell(x: number, y: number): CellRef | null {
  let best: CellRef | null = null,
    d = Infinity;
  for (let r = 0; r < K.GRID_ROWS; r++)
    for (let c = 0; c < K.GRID_COLS; c++) {
      const v = (x - xOf(c)) ** 2 + (y - yOf(r)) ** 2;
      if (v <= K.GEM_HIT_R ** 2 && v <= d) {
        best = ref(c, r);
        d = v;
      }
    }
  return best;
}
function abandon(s: FacetState): FacetState {
  return {
    ...s,
    screen: "title",
    menuIndex: 0,
    board: emptyBoard,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    swapPair: null,
    prismSeed: null,
    clearVisual: [],
    cutVisual: [],
    dealTimer: null,
  };
}
function start(s: FacetState): FacetState {
  return {
    ...initial(s.muted),
    screen: "playing",
    board: opening(),
    dealTimer: 0,
    pointer: s.pointer,
    simTime: s.simTime,
  };
}
function take(s: FacetState, id: string): FacetState {
  if (id === "back") return back(s);
  if (id === "pause") return pause(s);
  const i = Number(id.slice(5));
  if (!Number.isInteger(i) || i < 0) return s;
  const at = { ...s, menuIndex: i, armedTarget: null };
  if (s.screen === "title")
    return i === 0
      ? start(at)
      : i === 1
        ? { ...at, screen: "howto", menuIndex: 0 }
        : at;
  if (s.screen === "paused")
    return i === 0
      ? { ...at, screen: "playing", menuIndex: 0 }
      : i === 1
        ? abandon(at)
        : at;
  if (s.screen === "levelclear")
    return i === 0
      ? {
          ...at,
          screen: "playing",
          menuIndex: 0,
          level: s.level + 1,
          levelScore: 0,
          bestChain: 0,
          bestMove: 0,
          board: opening(),
          dealTimer: 0,
          lastCleared: 0,
          lastPoints: 0,
          lastWaves: 0,
        }
      : i === 1
        ? abandon(at)
        : at;
  if (s.screen === "gameover")
    return i === 0 ? start(at) : i === 1 ? abandon(at) : at;
  return at;
}
function pause(s: FacetState): FacetState {
  return s.screen === "playing"
    ? { ...s, screen: "paused", menuIndex: 0, armedTarget: null }
    : s.screen === "paused"
      ? { ...s, screen: "playing", menuIndex: 0, armedTarget: null }
      : s;
}
function back(s: FacetState): FacetState {
  return s.screen === "howto"
    ? { ...s, screen: "title", menuIndex: 1, armedTarget: null }
    : s.screen === "gameover"
      ? { ...s, screen: "title", menuIndex: 0, armedTarget: null }
      : s;
}
function pointerDown(
  s: DeepReadonly<FacetState>,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): FacetState {
  let n: FacetState = {
    ...s,
    pointer: { x, y, down: true, device },
  } as FacetState;
  const t = hitTarget(n.screen, x, y);
  if (t) {
    if (t.startsWith("menu-")) n = { ...n, menuIndex: Number(t.slice(5)) };
    return { ...n, armedTarget: t };
  }
  if (n.screen !== "playing") return { ...n, armedTarget: null };
  const p = hitCell(x, y);
  if (!p) return { ...n, selection: null, offer: null, armedTarget: null };
  if (!n.selection)
    return { ...n, selection: p, offer: null, armedTarget: null };
  if (same(p, n.selection)) return { ...n, offer: null, armedTarget: null };
  if (adjacent(p, n.selection)) return { ...n, offer: p, armedTarget: null };
  return { ...n, selection: p, offer: null, armedTarget: null };
}
function pointerMove(
  s: DeepReadonly<FacetState>,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): FacetState {
  let n: FacetState = {
    ...s,
    pointer: { x, y, down: s.pointer.down, device },
  } as FacetState;
  const t = hitTarget(n.screen, x, y);
  if (t?.startsWith("menu-") && !s.pointer.down)
    n = { ...n, menuIndex: Number(t.slice(5)) };
  if (n.screen === "playing" && n.pointer.down && n.selection) {
    const p = hitCell(x, y);
    if (same(p, n.selection)) n = { ...n, offer: null };
    else if (p && adjacent(p, n.selection)) n = { ...n, offer: p };
  }
  return n;
}
function pointerUp(
  s: DeepReadonly<FacetState>,
  device: PointerDevice = "mouse",
): FacetState {
  let n: FacetState = {
    ...s,
    pointer: { ...s.pointer, down: false, device },
  } as FacetState;
  const t = hitTarget(n.screen, n.pointer.x, n.pointer.y);
  if (n.armedTarget) {
    const armed = n.armedTarget;
    n = { ...n, armedTarget: null };
    return t === armed ? take(n, armed) : n;
  }
  if (n.screen === "playing" && n.selection && n.offer) {
    const a = n.selection,
      z = n.offer;
    n = { ...n, selection: null, offer: null };
    return request(n, a, z);
  }
  return n;
}
const parseToken = (token: string, c: number, r: number): GemState => {
  const m = /^([RACJBSMX])([0-3])([bs])?$/.exec(token);
  if (!m || (m[1] === "X" && m[3]))
    throw new Error(`Invalid gem token ${token}`);
  return gem(
    c,
    r,
    m[1] === "X" ? null : K.GEM_KINDS[letters.indexOf(m[1])],
    m[1] === "X"
      ? "prism"
      : m[3] === "b"
        ? "brilliant"
        : m[3] === "s"
          ? "star"
          : "plain",
    Number(m[2]),
  );
};
const assertCell = (c: number, r: number) => {
  if (!Number.isInteger(c) || !Number.isInteger(r) || !valid(c, r))
    throw new RangeError(`Invalid cell ${c},${r}`);
};
const assertPoints = (v: number, min = 0) => {
  if (!Number.isFinite(v) || v < min)
    throw new RangeError(`Invalid value ${v}`);
};
export interface FacetDebugApi {
  version: number;
  reset(s: DeepReadonly<FacetState>): FacetState;
  reconcile(s: DeepReadonly<FacetState>): FacetState;
  snapshot(s: DeepReadonly<FacetState>): ReturnType<typeof snapshot>;
  setScreen(s: DeepReadonly<FacetState>, v: Screen): FacetState;
  setMenuIndex(s: DeepReadonly<FacetState>, v: number): FacetState;
  loadBoard(s: DeepReadonly<FacetState>, rows: readonly string[]): FacetState;
  dealBoard(s: DeepReadonly<FacetState>): FacetState;
  clearBoard(s: DeepReadonly<FacetState>): FacetState;
  setGem(
    s: DeepReadonly<FacetState>,
    c: number,
    r: number,
    token: string,
  ): FacetState;
  setRefillKinds(
    s: DeepReadonly<FacetState>,
    c: number,
    kinds: string,
  ): FacetState;
  clearRefillKinds(s: DeepReadonly<FacetState>): FacetState;
  setScore(s: DeepReadonly<FacetState>, v: number): FacetState;
  setLevel(s: DeepReadonly<FacetState>, v: number): FacetState;
  setLevelScore(s: DeepReadonly<FacetState>, v: number): FacetState;
  setBestChain(s: DeepReadonly<FacetState>, v: number): FacetState;
  setBestMove(s: DeepReadonly<FacetState>, v: number): FacetState;
  setMoveScore(s: DeepReadonly<FacetState>, v: number): FacetState;
  setSelection(s: DeepReadonly<FacetState>, c: number, r: number): FacetState;
  clearSelection(s: DeepReadonly<FacetState>): FacetState;
  setOffer(s: DeepReadonly<FacetState>, c: number, r: number): FacetState;
  clearOffer(s: DeepReadonly<FacetState>): FacetState;
  clearRefusal(s: DeepReadonly<FacetState>): FacetState;
  clearChain(s: DeepReadonly<FacetState>): FacetState;
  requestSwap(
    s: DeepReadonly<FacetState>,
    ca: number,
    ra: number,
    cb: number,
    rb: number,
  ): FacetState;
  pointerDown(
    s: DeepReadonly<FacetState>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerMove(
    s: DeepReadonly<FacetState>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerUp(s: DeepReadonly<FacetState>, device?: PointerDevice): FacetState;
}
function snapshot(s: DeepReadonly<FacetState>) {
  return {
    version: K.FACET_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    score: s.score,
    level: s.level,
    levelScore: s.levelScore,
    levelTarget: K.LEVEL_TARGET_STEP * s.level,
    phase: s.phase,
    chainStep: s.chainStep,
    multiplier: Math.min(s.chainStep, K.MAX_MULTIPLIER),
    swapTimer: s.swapTimer,
    stepTimer: s.stepTimer,
    stepHold: stepHold(s),
    board: {
      cols: s.board.cols,
      rows: s.board.rows,
      cells: s.board.cells.map((g) => ({ ...g, x: xOf(g.col), y: yOf(g.row) })),
    },
    selection: s.selection,
    offer: s.offer,
    refusal: s.refusal ? { a: s.refusal.a, b: s.refusal.b } : null,
    lastCleared: s.lastCleared,
    lastPoints: s.lastPoints,
    lastWaves: s.lastWaves,
    lastFall: Math.max(0, ...s.board.cells.map((g) => g.fell)),
    moveScore: s.moveScore,
    bestMove: s.bestMove,
    bestChain: s.bestChain,
    legalSwap: legalSwap(s.board as BoardState),
    refillKinds: [...s.refillKinds],
    pointer: s.pointer,
    armedTarget: s.armedTarget,
    targets: targets(s.screen),
    muted: s.muted,
    simTime: s.simTime,
  };
}
const screenNames: Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "levelclear",
  "gameover",
];
export const debug: FacetDebugApi = {
  version: K.FACET_DEBUG_VERSION,
  reset: (s) => initial(s.muted),
  reconcile: (s) => ({ ...s }) as FacetState,
  snapshot,
  setScreen: (s, v) => {
    if (!screenNames.includes(v)) throw new Error(`Invalid screen ${v}`);
    return { ...s, screen: v } as FacetState;
  },
  setMenuIndex: (s, v) => {
    if (!Number.isInteger(v) || v < 0)
      throw new RangeError("Invalid menu index");
    return { ...s, menuIndex: v } as FacetState;
  },
  loadBoard: (s, rows) => {
    if (rows.length !== K.GRID_ROWS) throw new Error("Board needs eight rows");
    const cells: GemState[] = [];
    rows.forEach((line, r) => {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length !== K.GRID_COLS)
        throw new Error("Board needs eight columns");
      tokens.forEach((t, c) => cells.push(parseToken(t, c, r)));
    });
    return { ...s, board: boardOf(cells) } as FacetState;
  },
  dealBoard: (s) => ({ ...s, board: opening(), dealTimer: 0 }) as FacetState,
  clearBoard: (s) => ({ ...s, board: emptyBoard }) as FacetState,
  setGem: (s, c, r, t) => {
    assertCell(c, r);
    if (!s.board.cells.length) throw new Error("No board");
    const cells = [...s.board.cells];
    cells[idx(c, r)] = parseToken(t, c, r);
    return { ...s, board: boardOf(cells) } as FacetState;
  },
  setRefillKinds: (s, c, kinds) => {
    if (
      !Number.isInteger(c) ||
      c < 0 ||
      c >= K.GRID_COLS ||
      kinds.length > K.GRID_ROWS ||
      [...kinds].some((ch) => !letters.includes(ch))
    )
      throw new Error("Invalid refill");
    const a = [...s.refillKinds];
    a[c] = kinds;
    return { ...s, refillKinds: a } as FacetState;
  },
  clearRefillKinds: (s) =>
    ({ ...s, refillKinds: Array(K.GRID_COLS).fill("") }) as FacetState,
  setScore: (s, v) => {
    assertPoints(v);
    return { ...s, score: v } as FacetState;
  },
  setLevel: (s, v) => {
    if (!Number.isInteger(v)) throw new RangeError("Invalid level");
    assertPoints(v, 1);
    return { ...s, level: v } as FacetState;
  },
  setLevelScore: (s, v) => {
    assertPoints(v);
    return { ...s, levelScore: v } as FacetState;
  },
  setBestChain: (s, v) => {
    if (!Number.isInteger(v)) throw new RangeError("Invalid chain");
    assertPoints(v);
    return { ...s, bestChain: v } as FacetState;
  },
  setBestMove: (s, v) => {
    assertPoints(v);
    return { ...s, bestMove: v } as FacetState;
  },
  setMoveScore: (s, v) => {
    assertPoints(v);
    return { ...s, moveScore: v } as FacetState;
  },
  setSelection: (s, c, r) => {
    assertCell(c, r);
    return { ...s, selection: ref(c, r) } as FacetState;
  },
  clearSelection: (s) => ({ ...s, selection: null }) as FacetState,
  setOffer: (s, c, r) => {
    assertCell(c, r);
    return { ...s, offer: ref(c, r) } as FacetState;
  },
  clearOffer: (s) => ({ ...s, offer: null }) as FacetState,
  clearRefusal: (s) => ({ ...s, refusal: null }) as FacetState,
  clearChain: (s) =>
    ({
      ...s,
      phase: "idle",
      chainStep: 0,
      swapTimer: 0,
      stepTimer: 0,
      swapPair: null,
      prismSeed: null,
      clearVisual: [],
      cutVisual: [],
    }) as FacetState,
  requestSwap: (s, ca, ra, cb, rb) => {
    assertCell(ca, ra);
    assertCell(cb, rb);
    return request(s, ref(ca, ra), ref(cb, rb));
  },
  pointerDown,
  pointerMove,
  pointerUp,
};

const sprites = new Map<string, ImageBitmap>();
const particles = new Map<string, ParticleSystem>();
function cue(api: UpdateApi, name: string) {
  api.audio.play(name);
}
function runTime(s: FacetState, dt: number, api: UpdateApi): FacetState {
  if (s.screen !== "playing") return s;
  let n =
    s.dealTimer === null || s.dealTimer === undefined
      ? s
      : {
          ...s,
          dealTimer:
            s.dealTimer + dt >= K.GRID_ROWS * K.FALL_SECONDS_PER_ROW
              ? null
              : s.dealTimer + dt,
        };
  const heard = new Set<string>();
  const signal = (name: string) => heard.add(name);
  if (n.refusal) {
    const timer = n.refusal.timer + dt;
    n = {
      ...n,
      refusal: timer >= K.REFUSAL_SECONDS ? null : { ...n.refusal, timer },
    };
  }
  let remaining = dt,
    guard = 0;
  while (remaining > 0 && guard++ < 100 && n.screen === "playing") {
    if (n.phase === "swapping") {
      const span = K.SWAP_SECONDS - n.swapTimer,
        used = Math.min(remaining, span);
      remaining -= used;
      n = { ...n, swapTimer: n.swapTimer + used };
      if (n.swapTimer + 1e-9 >= K.SWAP_SECONDS) {
        n = { ...n, phase: "resolving", swapTimer: 0, chainStep: 1 };
        const result = resolveStep(n);
        n = result.state;
        emitStep(signal, result.event, n);
      }
    } else if (n.phase === "resolving") {
      const hold = stepHold(n),
        span = hold - n.stepTimer,
        used = Math.min(remaining, span);
      remaining -= used;
      n = { ...n, stepTimer: n.stepTimer + used };
      const landAt =
        n.lastWaves * K.WAVE_SECONDS +
        Math.max(0, ...n.board.cells.map((g) => g.fell)) *
          K.FALL_SECONDS_PER_ROW;
      if (
        n.stepTimer >= landAt &&
        n.stepTimer - used < landAt &&
        Math.max(...n.board.cells.map((g) => g.fell)) > K.LAND_MIN_ROWS
      )
        signal(K.CUES.land);
      if (n.stepTimer + 1e-9 >= hold) {
        n = { ...n, stepTimer: 0 };
        if (runs(n.board).length) {
          n = { ...n, chainStep: n.chainStep + 1, prismSeed: null };
          const result = resolveStep(n);
          n = result.state;
          emitStep(signal, result.event, n);
        } else {
          n = {
            ...n,
            phase: "idle",
            chainStep: 0,
            bestMove: Math.max(n.bestMove, n.moveScore),
            clearVisual: [],
            cutVisual: [],
            swapPair: null,
            prismSeed: null,
          };
          if (n.levelScore >= K.LEVEL_TARGET_STEP * n.level) {
            n = { ...n, screen: "levelclear", menuIndex: 0 };
            signal(K.CUES.levelUp);
          } else if (!legalSwap(n.board)) {
            n = { ...n, screen: "gameover", menuIndex: 0 };
            signal(K.CUES.gameOver);
          }
        }
      }
    } else break;
  }
  heard.forEach((name) => cue(api, name));
  return n;
}
function emitStep(signal: (name: string) => void, e: StepEvent, s: FacetState) {
  if (e.clear) {
    signal(K.CUES.clear);
    signal(`chain-${Math.min(s.chainStep, K.MAX_MULTIPLIER)}`);
  }
  if (e.flaw) signal(K.CUES.flaw);
  if (e.cut) signal(K.CUES.cut);
}
function drawParticle(
  ctx: CanvasRenderingContext2D,
  system: ParticleSystem,
  x: number,
  y: number,
  time: number,
  radius: number,
) {
  const canvas = ctx.canvas.ownerDocument?.createElement("canvas");
  if (!canvas) return;
  canvas.width = 70;
  canvas.height = 70;
  const surface = canvas.getContext("2d");
  if (!surface) return;
  new ParticleCanvasPlayer(system, surface, {
    clear: true,
    pixelRadius: radius,
  }).update(time);
  ctx.drawImage(canvas, x - 35, y - 35, 70, 70);
}
function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = "#ecf4f3",
  align: CanvasTextAlign = "left",
  weight = 500,
) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}
function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
}
function drawGem(
  ctx: CanvasRenderingContext2D,
  g: GemState,
  x: number,
  y: number,
  s: FacetState,
) {
  const key = g.cut === "prism" ? `prism-${g.strain}` : `${g.kind}-${g.strain}`;
  let image = sprites.get(key);
  let turn: ImageBitmap | undefined;
  if (g.cut === "prism" && s.phase !== "swapping") {
    const frame = Math.floor(s.simTime * 7) % 6;
    turn = sprites.get(`prism-turn-${frame}`);
    if (g.strain === 0) image = turn ?? image;
  }
  if (image) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, Math.round(x - 32), Math.round(y - 32), 64, 64);
  }
  if (turn && g.strain > 0) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(turn, Math.round(x - 32), Math.round(y - 32), 64, 64);
    ctx.restore();
  }
  if (g.cut === "brilliant" || g.cut === "star") {
    const overlay = sprites.get(g.cut);
    if (overlay)
      ctx.drawImage(overlay, Math.round(x - 32), Math.round(y - 32), 64, 64);
  }
}
function drawBoard(ctx: CanvasRenderingContext2D, s: FacetState) {
  const frame = sprites.get("board-frame");
  if (frame) ctx.drawImage(frame, 324, 80, 632, 632);
  for (let r = 0; r < K.GRID_ROWS; r++)
    for (let c = 0; c < K.GRID_COLS; c++)
      box(
        ctx,
        xOf(c) - 34,
        yOf(r) - 34,
        68,
        68,
        (c + r) % 2 ? "#102438" : "#132a3d",
      );
  const falling =
    s.phase === "resolving" ||
    (s.dealTimer !== null && s.dealTimer !== undefined);
  const shatterEnd = s.lastWaves * K.WAVE_SECONDS;
  const fallingT =
    s.phase === "resolving"
      ? Math.max(0, s.stepTimer - shatterEnd)
      : (s.dealTimer ?? 0);
  for (const g of s.board.cells) {
    let xx = xOf(g.col),
      yy = yOf(g.row);
    if (s.offer && s.selection) {
      if (same(g, s.offer)) {
        xx = xOf(s.selection.col);
        yy = yOf(s.selection.row);
      } else if (same(g, s.selection)) {
        xx = xOf(s.offer.col);
        yy = yOf(s.offer.row);
      }
    }
    if (s.phase === "swapping" && s.swapPair) {
      const [a, b] = s.swapPair,
        p = Math.min(1, s.swapTimer / K.SWAP_SECONDS),
        q = p * p * (3 - 2 * p);
      if (same(g, a)) {
        xx = xOf(b.col) + (xOf(a.col) - xOf(b.col)) * q;
        yy = yOf(b.row) + (yOf(a.row) - yOf(b.row)) * q;
      } else if (same(g, b)) {
        xx = xOf(a.col) + (xOf(b.col) - xOf(a.col)) * q;
        yy = yOf(a.row) + (yOf(b.row) - yOf(a.row)) * q;
      }
    }
    if (falling && g.fell > 0) {
      const p = Math.min(1, fallingT / (g.fell * K.FALL_SECONDS_PER_ROW));
      yy -= g.fell * K.CELL_PITCH * (1 - p) * (1 - p);
    }
    drawGem(ctx, g, xx, yy, s);
  }
  if (falling && s.clearVisual) {
    for (const { gem: g, wave } of s.clearVisual) {
      const t = s.stepTimer - wave * K.WAVE_SECONDS;
      if (t < 0 || t > 0.3) continue;
      const sequence = sprites.get(
        `break-${g.kind ?? "prism"}-${Math.min(3, Math.floor(t / 0.075))}`,
      );
      if (sequence)
        ctx.drawImage(sequence, xOf(g.col) - 32, yOf(g.row) - 32, 64, 64);
    }
  }
  if (s.selection) {
    ctx.strokeStyle = "#f6d17f";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      xOf(s.selection.col) - 35,
      yOf(s.selection.row) - 35,
      70,
      70,
    );
  }
  if (s.refusal) {
    ctx.strokeStyle = "#ff726c";
    ctx.lineWidth = 4;
    for (const p of [s.refusal.a, s.refusal.b])
      ctx.strokeRect(xOf(p.col) - 34, yOf(p.row) - 34, 68, 68);
  }
}
function drawTargets(ctx: CanvasRenderingContext2D, s: FacetState) {
  for (const t of targets(s.screen)) {
    if (t.id.startsWith("menu-")) {
      const i = Number(t.id.slice(5));
      const label = targetRows(s.screen)[i];
      box(
        ctx,
        t.x,
        t.y,
        t.w,
        t.h,
        s.menuIndex === i ? "#2a5665" : "#142a3b",
        s.menuIndex === i ? "#e8c980" : "#4d6b74",
      );
      paintText(
        ctx,
        label,
        t.x + t.w / 2,
        t.y + 49,
        25,
        s.menuIndex === i ? "#fff3cf" : "#d6e8e8",
        "center",
        700,
      );
    } else {
      box(ctx, t.x, t.y, t.w, t.h, "#1c3948", "#78959a");
      paintText(
        ctx,
        t.id === "pause" ? K.PAUSE_LABEL : K.BACK_LABEL,
        t.x + t.w / 2,
        t.y + 45,
        20,
        "#e4eeeb",
        "center",
        700,
      );
    }
  }
}
function drawHud(ctx: CanvasRenderingContext2D, s: FacetState) {
  paintText(ctx, K.HUD_SCORE_LABEL, 352, 42, 15, "#8ab7b5");
  paintText(ctx, s.score.toLocaleString(), 352, 79, 33, "#f8e8c4", "left", 700);
  paintText(
    ctx,
    `${K.HUD_LEVEL_LABEL} ${s.level}`,
    787,
    45,
    20,
    "#d5eee9",
    "left",
    700,
  );
  box(ctx, 786, 60, 175, 9, "#314b59");
  box(
    ctx,
    786,
    60,
    175 * Math.min(1, s.levelScore / (K.LEVEL_TARGET_STEP * s.level)),
    9,
    "#eacb83",
  );
  if (s.phase === "resolving")
    paintText(
      ctx,
      `${K.HUD_CHAIN_LABEL} ×${Math.min(s.chainStep, K.MAX_MULTIPLIER)}`,
      1010,
      165,
      25,
      "#f8d38c",
      "left",
      750,
    );
}
function overlay(ctx: CanvasRenderingContext2D, s: FacetState) {
  if (s.screen === "playing") return;
  if (s.screen === "title") {
    for (let i = 0; i < K.GEM_KINDS.length; i++) {
      const sprite = sprites.get(`${K.GEM_KINDS[i]}-0`);
      if (sprite) {
        const xx = 430 + i * 70;
        const yy = 355 + Math.abs(i - 3) * 6;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, xx - 25, yy - 25, 50, 50);
      }
    }
    paintText(ctx, K.TITLE_TEXT, 640, 255, 104, "#fff0c5", "center", 800);
    paintText(ctx, K.TAGLINE_TEXT, 640, 300, 19, "#91bec1", "center", 600);
    drawTargets(ctx, s);
    paintText(
      ctx,
      "A GAME OF LIGHT AND PRESSURE",
      640,
      651,
      14,
      "#6e949c",
      "center",
    );
    return;
  }
  if (s.screen === "howto") {
    box(ctx, 205, 105, 870, 555, "#102437", "#497184");
    paintText(ctx, "HOW TO PLAY", 640, 158, 38, "#fff0c5", "center", 800);
    const lines = [
      "Seven kinds of gems fill the grid. Drag one onto a neighbor and release to swap.",
      "Carry it back to play nothing. Three in a line shatter; empty swaps are refused.",
      "Every gem beside a clear takes strain. At three, it becomes flawed:",
      "a flawed gem shatters when touched by a clear and scores double.",
      "Four in a line leaves a brilliant; five leaves a prism; crossings leave stars.",
      "Brilliant clears its ring. Star clears its row and column.",
      "Swap a prism with a gem to clear every stone of that kind.",
      "Falling gems can chain. Each new step scores more. Reach the level target.",
      "A round ends when no shattering swap remains.",
      "Mouse, pen or touch: play the board. ↑ ↓ menus · Enter / Space choose.",
      "Escape / P pause · M mute · Escape backs out.",
    ];
    lines.forEach((line, i) =>
      paintText(
        ctx,
        line,
        242,
        210 + i * 37,
        19,
        i % 3 === 0 ? "#e8d7a8" : "#c5dddc",
      ),
    );
    drawTargets(ctx, s);
    return;
  }
  box(ctx, 0, 0, K.STAGE_W, K.STAGE_H, "#071320bb");
  box(ctx, 380, 176, 520, 488, "#102839", "#61818a");
  const title =
    s.screen === "paused"
      ? K.PAUSED_TITLE_TEXT
      : s.screen === "levelclear"
        ? K.LEVELCLEAR_TITLE_TEXT
        : K.GAMEOVER_TITLE_TEXT;
  paintText(ctx, title, 640, 254, 40, "#fff0c5", "center", 800);
  if (s.screen === "levelclear") {
    paintText(ctx, `LEVEL ${s.level}`, 640, 314, 23, "#d5e8e4", "center");
    paintText(
      ctx,
      `${K.BEST_CHAIN_LABEL}  ${s.bestChain}`,
      640,
      356,
      20,
      "#bed6d3",
      "center",
    );
    paintText(
      ctx,
      `${K.BEST_MOVE_LABEL}  ${s.bestMove.toLocaleString()}`,
      640,
      390,
      20,
      "#bed6d3",
      "center",
    );
  }
  if (s.screen === "gameover") {
    paintText(
      ctx,
      `SCORE  ${s.score.toLocaleString()}`,
      640,
      325,
      26,
      "#e8d7a8",
      "center",
    );
    paintText(ctx, `LEVEL ${s.level}`, 640, 365, 20, "#c6dddb", "center");
  }
  drawTargets(ctx, s);
}
export const game: Game<FacetState, FacetDebugApi> = {
  async initialize(api: InitApi<FacetState>) {
    for (const action of K.ACTIONS)
      api.input.register(action, { keys: [...K.BINDINGS[action]] });
    const imageNames: string[] = [];
    for (const kind of K.GEM_KINDS) {
      for (let strain = 0; strain <= K.MAX_STRAIN; strain++)
        imageNames.push(`${kind}-${strain}`);
      for (let i = 0; i < 4; i++) imageNames.push(`break-${kind}-${i}`);
    }
    for (let strain = 0; strain <= K.MAX_STRAIN; strain++)
      imageNames.push(`prism-${strain}`);
    for (let i = 0; i < 4; i++) imageNames.push(`break-prism-${i}`);
    for (let i = 0; i < 6; i++) imageNames.push(`prism-turn-${i}`);
    imageNames.push("brilliant", "star", "board-frame");
    await Promise.all(
      imageNames.map(async (name) => {
        let path: string;
        if (name.startsWith("break-")) {
          const m = /^break-(\w+)-(\d+)$/.exec(name)!;
          path = `gems/break/${m[1]}/${m[2]}.png`;
        } else if (name.startsWith("prism-turn-"))
          path = `gems/prism-turn/${name.slice(-1)}.png`;
        else path = `gems/${name}.png`;
        sprites.set(name, await api.assets.loadImage(path));
      }),
    );
    await Promise.all(
      ["clear", "flawed", "cut-flash", "aura"].map(async (name) => {
        const blob = await api.assets.load(`fx/${name}/system.json`);
        particles.set(name, JSON.parse(await blob.text()) as ParticleSystem);
      }),
    );
    const names = [
      ...Object.values(K.CUES),
      ...Array.from({ length: K.MAX_MULTIPLIER }, (_, i) => `chain-${i + 1}`),
      "title-music",
      "play-music",
    ];
    await Promise.all(
      names.map((n) =>
        api.audio.load(n, `audio/${n === K.CUES.clear ? "shatter" : n}.wav`),
      ),
    );
    api.diagnostics.register("screen", (s) => s.screen);
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("board", (s) => `${s.board.cols}×${s.board.rows}`);
    api.diagnostics.register("score", (s) => s.score);
    api.diagnostics.register(
      "level",
      (s) => `${s.level} ${s.levelScore}/${s.level * K.LEVEL_TARGET_STEP}`,
    );
    api.diagnostics.register(
      "chain",
      (s) => `${s.chainStep} ×${Math.min(s.chainStep, K.MAX_MULTIPLIER)}`,
    );
    api.diagnostics.register(
      "clear",
      (s) =>
        `${s.lastCleared} +${s.lastPoints} waves ${s.lastWaves} fall ${Math.max(0, ...s.board.cells.map((g) => g.fell))}`,
    );
    api.diagnostics.register(
      "selection",
      (s) =>
        `${s.selection?.col ?? "-"},${s.selection?.row ?? "-"} → ${s.offer?.col ?? "-"},${s.offer?.row ?? "-"}`,
    );
    api.diagnostics.register("best", (s) => `${s.bestMove} / ${s.bestChain}`);
    api.diagnostics.register("legal", (s) => legalSwap(s.board as BoardState));
    api.diagnostics.register(
      "pointer",
      (s) =>
        `${s.pointer.x.toFixed(0)},${s.pointer.y.toFixed(0)} ${s.pointer.device}`,
    );
    return [initial(), debug];
  },
  update(
    state: DeepReadonly<FacetState>,
    api: UpdateApi,
    dt: number,
  ): FacetState {
    let s: FacetState = { ...state, simTime: state.simTime + dt } as FacetState;
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
    const edges = Object.fromEntries(
      K.ACTIONS.map((a) => [a, api.input.pressed(a)]),
    ) as Record<K.ActionName, boolean>;
    if (edges.pause) s = pause(s);
    if (edges.back) s = back(s);
    const items = targetRows(s.screen);
    if (items.length) {
      if (edges.up)
        s = {
          ...s,
          menuIndex: (s.menuIndex + items.length - 1) % items.length,
        };
      if (edges.down) s = { ...s, menuIndex: (s.menuIndex + 1) % items.length };
      if (edges.confirm) s = take(s, `menu-${s.menuIndex}`);
    }
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary) continue;
      if (sample.type === "down" && sample.button === "primary") {
        const old = s.selection;
        s = pointerDown(s, sample.x, sample.y, sample.device);
        if (s.selection && (!old || !same(old, s.selection)))
          cue(api, K.CUES.select);
      } else if (sample.type === "move")
        s = pointerMove(s, sample.x, sample.y, sample.device);
      else if (sample.type === "up" && sample.button === "primary") {
        s = pointerMove(s, sample.x, sample.y, sample.device);
        const was = s.phase,
          oldRef = s.refusal;
        s = pointerUp(s, sample.device);
        if (was === "idle" && s.phase === "swapping") cue(api, K.CUES.swap);
        if (!oldRef && s.refusal) cue(api, K.CUES.refuse);
      }
    }
    const p = api.input.pointer();
    s = {
      ...s,
      pointer: { x: p.x, y: p.y, down: p.down, device: p.device },
      muted: api.audio.muted(),
    };
    s = runTime(s, dt, api);
    if (s.screen === "title" || s.screen === "howto") {
      if (!api.audio.looping("title-music")) api.audio.loop("title-music");
      if (api.audio.looping("play-music")) api.audio.stop("play-music");
    } else {
      if (!api.audio.looping("play-music")) api.audio.loop("play-music");
      if (api.audio.looping("title-music")) api.audio.stop("title-music");
    }
    return s;
  },
  render(state: DeepReadonly<FacetState>, api: RenderApi) {
    const s = state as FacetState,
      ctx = api.ctx;
    box(ctx, 0, 0, K.STAGE_W, K.STAGE_H, BACKGROUND);
    const glow = ctx.createRadialGradient(640, 355, 60, 640, 355, 620);
    glow.addColorStop(0, "#17384a");
    glow.addColorStop(1, BACKGROUND);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, K.STAGE_W, K.STAGE_H);
    for (let i = 0; i < 37; i++) {
      const x = (i * 271) % 1280,
        y = (i * 193) % 720;
      box(ctx, x, y, 2, 2, "#42647266");
    }
    if (s.board.cells.length && s.screen !== "title" && s.screen !== "howto") {
      drawBoard(ctx, s);
      drawHud(ctx, s);
    }
    if (s.screen === "playing") drawTargets(ctx, s);
    overlay(ctx, s);
    if (s.screen === "playing" && particles.size) {
      const aura = particles.get("aura");
      if (aura)
        for (const g of s.board.cells)
          if (g.cut !== "plain")
            drawParticle(
              ctx,
              aura,
              xOf(g.col),
              yOf(g.row),
              (s.simTime % 1.1) + 0.016,
              1.5,
            );
      if (s.phase === "resolving" && s.clearVisual)
        for (const v of s.clearVisual) {
          const t = s.stepTimer - v.wave * K.WAVE_SECONDS;
          if (t >= 0 && t < 0.45) {
            const system = particles.get(
              v.gem.strain === K.MAX_STRAIN ? "flawed" : "clear",
            );
            if (system)
              drawParticle(
                ctx,
                system,
                xOf(v.gem.col),
                yOf(v.gem.row),
                t + 0.016,
                2,
              );
          }
        }
      if (s.phase === "resolving" && s.cutVisual && s.stepTimer < 0.35) {
        const system = particles.get("cut-flash");
        if (system)
          for (const p of s.cutVisual)
            drawParticle(
              ctx,
              system,
              xOf(p.col),
              yOf(p.row),
              s.stepTimer + 0.016,
              1.5,
            );
      }
    }
  },
};
