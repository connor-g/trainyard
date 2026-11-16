# Caleb's Train Yard

A model railway for kids that runs in the browser, designed for my toddler son. Lay tracks, add bridges and tunnels, couple cars to an engine, and watch your trains make their rounds. Start with Meadow Loop, Harbor Line, Pine Summit, or Red Mesa Crossing, or build a yard from scratch.

I built the app entirely with Codex and haven’t personally reviewed any of the code. Most of the app came from a single paragraph-long prompt. I spent a few more hours iterating with Codex based on how my son played with it. The UI was designed for a 13" iPad and has not been tested on any other devices or layouts.

<img width="1600" height="1200" alt="Screenshot 2026-11-13 at 9 09 33 PM" src="https://github.com/user-attachments/assets/b938a882-d6fe-4ac4-9f4a-1aa8d2d290c9" />

## Run locally

With Node.js installed, run these commands in Terminal.

```sh
git clone https://github.com/connor-g/trainyard.git
cd trainyard
npm install
npm run dev
```

Open the address the dev server prints. To play from another device on your home network, run `npm run dev -- --host` and open the network address it prints on that device.

## Build and play

- Drag pieces from **Track** onto the grid. Tap a piece to turn it, or drag it to **Remove** to take it off the board.
- In **Cars**, drop an engine onto a track and add cars near it to couple them. Tap an engine to hear its horn.
- Use the speed controls to pause or speed up the trains, and the sound button to mute them.
- Open **Layouts** to change the background or grid size, start blank, or choose **Save or load a yard** to open a preset or save your own.

## Layouts and saves

The built-in layouts are defined in [src/presets.ts](src/presets.ts). Saved yards are stored in the browser's local storage, so they stay on the device and browser where you saved them. A save holds the yard as built, with each train at its start position, so reloading the page starts every train from where it was placed.

## Development

The app is built with [Vite+](https://viteplus.dev/). Run `npm install`, then:

- `npm run dev` starts the dev server.
- `npm run build` builds the app into `dist/`.
- `npm run check` checks formatting and runs lint and type checks. `npm run fix` formats the code and applies lint fixes.
- `npm test` runs the tests in `test/`, including recorded 30-second runs of every built-in yard that fail on any change in how trains move.

The app's source is in `src/`, with `index.html` at the repository root. Files in `public/` are copied to the build unchanged.

- `src/railway.ts` holds the catalogs and track geometry.
- `src/model/` is the game model, with no state of its own. A `Yard` is what the player built (the board, background and each train's cars and start path) and `Motion` is where the trains are right now. Both are immutable, and frozen in development and tests so accidental changes throw. `applyEdit` turns an edit into a new yard and motion, and `step` advances the trains.
- `src/store.ts` holds the current yard, the motion and an in-memory undo stack. Undo reverses one edit and never rewinds train movement.
- `src/saves.ts` reads and writes saved yards in local storage.
- `src/yard.ts` is the page: input, rendering, sound and dialogs.

TypeScript is set up with strict typing, erasable syntax only, and isolated modules, targeting ES2025 to match the latest Safari. All source files are TypeScript (`.ts`).

## License

Trainyard is available under the [MIT license](LICENSE).
