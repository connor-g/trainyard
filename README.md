# Caleb's Train Yard

A model railway for kids that runs in the browser, designed for my toddler son. Lay tracks, add bridges and tunnels, couple cars to an engine, and watch your trains make their rounds. Start with Meadow Loop, Harbor Line, Pine Summit, or Red Mesa Crossing, or build a yard from scratch.

I built the app entirely with Codex and haven’t personally reviewed any of the code. Most of the app came from a single paragraph-long prompt. I spent a few more hours iterating with Codex based on how my son played with it. The UI was designed for a 13" iPad and has not been tested on any other devices or layouts.

<img width="1600" height="1200" alt="Screenshot 2026-11-13 at 9 09 33 PM" src="https://github.com/user-attachments/assets/b938a882-d6fe-4ac4-9f4a-1aa8d2d290c9" />

## Run locally

With Docker and Docker Compose installed, run these commands in Terminal.

```sh
git clone https://github.com/connor-g/trainyard.git
cd trainyard
RAIL_YARD_LAN_IP=127.0.0.1 docker compose up --build -d
```

Open [http://localhost:8090](http://localhost:8090). To play from another device on your home network, replace `127.0.0.1` in the command with the Docker host's LAN IP, then open `http://<host-ip>:8090` on that device.

Run `docker compose down` to stop the app. Your saved yards stay on disk.

## Build and play

- Drag pieces from **Track** onto the grid. Tap a piece to turn it, or drag it to **Remove** to take it off the board.
- In **Cars**, drop an engine onto a track and add cars near it to couple them. Tap an engine to hear its horn.
- Use the speed controls to pause or speed up the trains, and the sound button to mute them.
- Open **Layouts** to change the background or grid size, start blank, or choose **Save or load a yard** to open a preset or save your own.

## Layouts and saves

Docker Compose runs the browser app through Nginx and a small Node.js service for saving and loading layouts. The built-in layouts are defined in [src/railway.ts](src/railway.ts) and [presets.ts](presets.ts). The service creates any missing presets at startup. It stores yard saves in `saved-yards/`, which Git ignores.

[layout.schema.json](layout.schema.json) is a JSON Schema (draft 2020-12) for yard files. It describes what the service saves and accepts, so you can check a hand-edited or generated yard before loading it. Set a yard file's `"$schema"` key to the schema's path to get completion and validation in your editor; the service drops that key when it saves.

## Development

The app is built with [Vite+](https://viteplus.dev/). Run `npm install`, then:

- `npm run dev` starts the dev server. Run `npm run layouts` alongside it so saving and loading yards works; the dev server forwards `/api/layouts` to it.
- `npm run build` builds the app into `dist/`.
- `npm run check` checks formatting and runs lint and type checks. `npm run fix` formats the code and applies lint fixes.

The app's source is in `src/`, with `index.html` at the repository root. Files in `public/` are copied to the build unchanged.

TypeScript is set up with strict typing, erasable syntax only, and isolated modules, targeting ES2025 to match the latest Safari. All source files are TypeScript (`.ts`), and Node runs the layouts service directly by stripping types.

## License

Trainyard is available under the [MIT license](LICENSE). The bundled [DM Sans](public/dm-sans-license.txt) and [DM Serif](public/dm-serif-license.txt) fonts use the SIL Open Font License 1.1.
