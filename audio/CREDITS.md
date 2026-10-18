# Sample credits

## Drums
- `drums/tr808/`: Roland TR-808 samples recorded by Michael Fischer, from
  machines.hyperreal.org via [fluid-music/open-drums](https://github.com/fluid-music/open-drums).
  No licensing restrictions (see `TR808.TXT`). File names keep the original codes:
  `BD` kick, `SD` snare, `CH`/`OH` closed/open hat, `CP` clap, `RS` rim, `CB` cowbell,
  `CL` claves, `MA` maracas, `LT`/`MT`/`HT` toms, `LC`/`MC`/`HC` congas, `CY` cymbal.
  The digits are knob settings (tone, decay).
- `drums/tr707/`: Roland TR-707 samples by Francois Dion, same source, no licensing
  restrictions (see `README.txt`).
- The TR-909 set in that repo was left out on purpose: its author forbids removing
  samples from the set or using it for profit.

## Instruments
- `instruments/*/`: single notes rendered from the FluidR3_GM soundfont by
  [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts),
  released under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/).
  Credit is shown in the game footer.
- Only every third semitone is stored (C, Eb, Gb, A in each octave). The engine
  pitch-shifts the nearest note by at most 1.5 semitones to play the rest.
- Basses cover octaves 1-4; everything else covers octaves 2-6.
