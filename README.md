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

Docker Compose runs the browser app through Nginx and a small Node.js service for saving and loading layouts. The built-in layouts are defined in [public/railway.mjs](public/railway.mjs) and [presets.mjs](presets.mjs). The service creates any missing presets at startup. It stores yard saves in `saved-yards/`, which Git ignores.

## Type checking

The repository is set up for TypeScript with strict typing, erasable syntax only, and isolated modules, targeting ES2025 to match the latest Safari. Run `npm install`, then `npm test`. New modules can be written as `.mts`. The existing `.mjs` files aren't checked until you add `// @ts-check` at the top of a file.

## License

Trainyard is available under the [MIT license](LICENSE). The bundled [DM Sans](public/dm-sans-license.txt) and [DM Serif](public/dm-serif-license.txt) fonts use the SIL Open Font License 1.1.
