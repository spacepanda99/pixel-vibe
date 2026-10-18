# Pixel Vibe

A retro arcade rhythm shooter that plays in the browser (and installs to the phone home screen). Old-school Galaga-style pixel graphics: your ship's shots are the drums, and other things (shield, pickups, enemies) each trigger different instrument sounds, so playing the game plays the music.

This is a brand-new project, separate from GabLab (`C:\Mikes Stuff\call-recorder`) and ProfilePilot (`C:\Mikes Stuff\ProfilePilot`). Do not touch those folders, their repos or their Firebase/Cloudflare accounts.

## Decisions so far
- **Plain HTML + vanilla JS + `<canvas>` + Web Audio.** No game engine. Godot is installed on this PC but was judged not worth it for a rhythm game (heavy web build, worse audio latency, nothing here needs physics or 3D).
- **Timing is everything.** Schedule sounds and judge hits against `AudioContext.currentTime`, not `setTimeout` or frame counts. Include a latency calibration screen (tap along to a beat) because Bluetooth and phone audio add delay. Never let frame-rate hiccups move the music.
- **Pixel look:** low-res canvas (e.g. 224x288 or 320x180) scaled up with `image-rendering: pixelated`, chunky sprites drawn in code or small PNGs, limited palette, CRT/scanline option is a nice extra.
- **Sound:** synthesize drums and chiptune with Web Audio (oscillators and noise), so there are no audio files to license. Keep one shared master clock and a BPM so everything lands on the grid.
- **Controls:** touch first (drag to move, tap/hold to fire), keyboard second.
- **Hosting:** GitHub Pages, same pattern as GabLab (static files, `?v=` cache-busting on scripts, a version number in the footer, a service worker for install/offline). Do not create the GitHub repo until the user says so.

## Working rules (from the user)
- Keep answers to the user very brief.
- Never open the Browser/preview pane. Verify with headless Chrome over CDP (the `chrome.exe` at `C:\Program Files\Google\Chrome\Application\`), screenshots at phone width (360-412 px), and `node --check`. Never kill all `chrome.exe`: the user's own browser runs here.
- There are no real phones to test on from here, so say plainly what was and wasn't tested.
- Ask before any paid API call (even a few cents) and before creating any cloud project or GitHub repo.
- Commit after meaningful chunks of work. End commit messages with the attribution line from the session reminder.
- The PC is a 2-core, 4 GB RAM VM with no GPU and about 13 GB free disk. Headless WebGL is slow (about 2 fps), so prefer 2D canvas and keep test runs short.
- Shell notes: shell heredocs break on apostrophes, so write files with the file tool or a small `.cjs` patch script.
- Brand/art direction is open: ask the user for colours and the feel they want before polishing visuals.
