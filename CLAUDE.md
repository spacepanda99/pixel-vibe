# Pixel Vibe

A retro arcade rhythm shooter that plays in the browser (and installs to the phone home screen). Old-school Galaga-style pixel graphics: your ship's shots are the drums, and other things (shield, pickups, enemies) each trigger different instrument sounds, so playing the game plays the music.

This is a brand-new project, separate from GabLab (`C:\Mikes Stuff\call-recorder`) and ProfilePilot (`C:\Mikes Stuff\ProfilePilot`). Do not touch those folders, their repos or their Firebase/Cloudflare accounts.

## Decisions so far
- **Plain HTML + vanilla JS + `<canvas>` + Web Audio.** No game engine. Godot is installed on this PC but was judged not worth it for a rhythm game (heavy web build, worse audio latency, nothing here needs physics or 3D).
- **Timing is everything.** Schedule sounds and judge hits against `AudioContext.currentTime`, not `setTimeout` or frame counts. Include a latency calibration screen (tap along to a beat) because Bluetooth and phone audio add delay. Never let frame-rate hiccups move the music.
- **Pixel look:** low-res canvas (e.g. 224x288 or 320x180) scaled up with `image-rendering: pixelated`, chunky sprites drawn in code or small PNGs, limited palette, CRT/scanline option is a nice extra.
- **Sound:** real recorded samples, not synthesis (the user wants it to sound really good). `audio/` holds TR-808/707 drums and 26 FluidR3 instruments; sources and licenses are in `audio/CREDITS.md`. Only use samples whose license allows it (the TR-909 set was rejected). Lots of instruments are wanted because ships will each have their own sounds; `LOADOUT` in `js/audio.js` picks them. Keep one shared master clock and a BPM so everything lands on the grid.
- **Game screen (v0.1.0):** three cannons (drums, bass, vibraphone) fire on their own notes; three piano keys under them (each the colour of its shield, no icons) raise a shield over each cannon and play a chord tone on the player's own big layered synth (two detuned saws, synth brass, a saw an octave down, filter sweep, dotted-8th echo); the keys are what the player controls, so their sound matters most; drag above a cannon to aim it. Headless check script: `check.mjs` pattern (Node http server + CDP at 390x844).
- **Controls:** touch first (drag to move, tap/hold to fire), keyboard second.
- **Hosting:** GitHub Pages (live at https://spacepanda99.github.io/pixel-vibe/), installable since v0.2.0 (`manifest.webmanifest`, `icons/`, `sw.js`; bump `VERSION` in `sw.js` with every `?v=` bump), same pattern as GabLab (static files, `?v=` cache-busting on scripts, a version number in the footer, a service worker for install/offline). Repo: `spacepanda99/pixel-vibe` (public, so free Pages works), created 2026-10-18.

## Working rules (from the user)
- Keep answers to the user very brief.
- Never open the Browser/preview pane. Verify with headless Chrome over CDP (the `chrome.exe` at `C:\Program Files\Google\Chrome\Application\`), screenshots at phone width (360-412 px), and `node --check`. Never kill all `chrome.exe`: the user's own browser runs here.
- There are no real phones to test on from here, so say plainly what was and wasn't tested.
- Ask before any paid API call (even a few cents) and before creating any cloud project or GitHub repo.
- Commit after meaningful chunks of work. End commit messages with the attribution line from the session reminder.
- The PC is a 2-core, 4 GB RAM VM with no GPU and about 13 GB free disk. Headless WebGL is slow (about 2 fps), so prefer 2D canvas and keep test runs short.
- Shell notes: shell heredocs break on apostrophes, so write files with the file tool or a small `.cjs` patch script.
- Brand/art direction is open: ask the user for colours and the feel they want before polishing visuals.
