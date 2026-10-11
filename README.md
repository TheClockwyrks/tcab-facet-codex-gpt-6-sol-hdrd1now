# Facet

Facet is a browser puzzle about matching cut stones and building pressure. Swap neighboring gems to make lines of three or more. Clears strain the stones beside them; at three strain, a stone is flawed and will shatter with any clear that touches it for double points. Longer lines leave powerful cuts, and falling stones can set off multiplying chains.

## Run it

Requires Node.js and npm. The repository includes every image, particle system, and sound the game uses under `public/assets/`.

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. To create the static release, run `npm run build`; serve `dist/` from any static server, including a subpath. The build bundles the committed assets and needs no asset-generation tools. `npm run preview` serves the built release locally.

## Controls

Use a mouse, pen, or finger to press a gem, drag or press onto an adjacent gem, and release to swap. A swap that makes no match is refused. The menus work with the pointer or with **↑ / ↓** and **Enter / Space**. **Escape / P** pauses or resumes, **M** mutes, and **Escape** backs out of How to Play and Game Over. All screens have large pointer controls.

The in-game How to Play screen explains strain, flawed gems, cuts, chains, and level goals.

## Development

`npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` run the project checks. The game uses the Simple 2D engine for its loop, input, canvas fit, asset loading, audio, diagnostics, and recording. Its pure state transitions and debug surface live in `src/game.ts`.
