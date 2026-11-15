# Game thumbnail and trailer

Capture real gameplay from the built game. Run `gm look shell --dist <game/dist> --out <directory> --mp4` with the appropriate `--tap` path to reach gameplay; repeat with different actions or scenarios. The shell records only about nine seconds after the taps before opening its menu, and its taps do not drive gameplay controls. Use it for shell and aspect-ratio checks, not as the sole source of a trailer. To record real player input, run the game's dev server locally, open it in a browser, play it and record the browser window with the host's screen recorder. On an X11 host, for example, get the window geometry with `xwininfo`, then use `ffmpeg -f x11grab -framerate 30 -video_size <width>x<height> -i "$DISPLAY+<x>,<y>" -t 30 -c:v libx264 -pix_fmt yuv420p take1.mp4`; stop early with `q`. Repeat at portrait and landscape browser sizes and cut loading or menu frames. On other display systems use the host's window recorder. `gm run --inputs` checks scripted actions after its MP4 capture, so it is not a substitute for recorded player input. Use the phone portrait, phone landscape and desktop checks in `gm-verify`. Open every capture and check it shows the current game. The shell mocks sign-in and APIs; do not describe its capture as production.

Make the thumbnail from a gameplay still and the approved logo. For each trailer orientation, pick gameplay ranges totalling 15–30 seconds. For example, cut three six-second ranges (replace the input names and start times after inspecting the recordings), then join them:

```sh
ffmpeg -ss 5 -i take1.mp4 -t 6 -an -c:v libx264 -pix_fmt yuv420p part1.mp4
ffmpeg -ss 5 -i take2.mp4 -t 6 -an -c:v libx264 -pix_fmt yuv420p part2.mp4
ffmpeg -ss 5 -i take3.mp4 -t 6 -an -c:v libx264 -pix_fmt yuv420p part3.mp4
printf "file 'part1.mp4'\nfile 'part2.mp4'\nfile 'part3.mp4'\n" > cuts.txt
ffmpeg -f concat -safe 0 -i cuts.txt -c copy silent.mp4
```

Playwright's shell recording is silent. Find the game's own music and effect files in its source or asset lock; place the selected music under the cut, then place each gameplay effect at its visible event time. For example, for an effect at 3.2 seconds in an 18-second cut:

```sh
ffmpeg -i silent.mp4 -i music.wav -i effect.wav -filter_complex '[1:a]atrim=0:18,asetpts=PTS-STARTPTS[m];[2:a]adelay=3200|3200[e];[m][e]amix=inputs=2:duration=first[a]' -map 0:v -map '[a]' -c:v copy -c:a aac -movflags +faststart public/media/trailer-landscape.mp4
```

Repeat the delay/mix inputs for each effect and repeat the whole cut for portrait as `trailer-portrait.mp4`. Listen and inspect both MP4s, checking synchronization and keeping audio peaks below -1 dBFS. Store the thumbnail at `public/media/thumbnail.png`; the build copies these files to `dist/media/`. Publish the build with `gm publish`. File refresh tickets whenever a major visual or core gameplay change makes either asset stale.
