# Plinth

Turn the details of an upcoming real-estate project into a narrated film, views of the building and ready-to-post posters. Everything runs on this computer.

## Start

Needs Node 20 or later, ffmpeg, and Chrome, Edge, Brave or Chromium.

    npm install
    npm start

Open http://localhost:4600. `npm run sample` adds a made-up project to try.

## What it does

1. **Project, Homes, Building.** Enter the details. The 3D model on the right follows your building settings.
2. **Photos.** Add your own photos or renders. Each can appear in the film with a caption.
3. **Film.** Choose the shape, lettering, light, voice and music, and edit the script.
4. **Make film, Make photos, Make posters.** Finished files collect under the preview and are saved in `data/<project>/out`.

The script only uses details you enter. The 3D model is an impression built from your settings, not an architect's drawing. Films, views and posters of it are labelled as an artist's impression. Have the final ad checked against the advertising rules that apply to you, such as RERA in India.

## Photoreal reels

Under Film, choose **Photoreal reel**. Plinth turns views of your 3D model into photographs, makes the rooms and amenities, moves a camera through each in depth, and adds timed captions, narration, music and effects. Everything runs on this Mac with open models and no per-video fee.

    npm run setup-ai

This downloads about 6 GB once (Apple Silicon only): FLUX.2-klein-4B 4-bit, Depth-Anything-V2-Small and the Kokoro-82M voice, all Apache 2.0. Allow 1 to 2 minutes per picture on a 16 GB Mac; a reel uses about 18, and they are kept. Any shot can be made again or replaced with your own picture or video clip. People, water and curtains in generated pictures do not move.

Generated pictures can show things the project will not have. Check each one, and keep the "Artist's impression" label.

## Voices and music

The offline voices speak English. Mac voices, including Hindi, are also listed. Music and effects are composed by the app, so they need no licence. You can use your own track. Finished sound is set to about -14 LUFS, the level social apps expect.

## Photoreal images (optional)

Copy `.env.example` to `.env`, set `OPENAI_API_KEY` and restart. A "Make photoreal" button appears on each view. Pressing it sends that image and your facade and surroundings settings to OpenAI, which charges per image. Check the result before using it: an AI image can change the design or lose the label.

## Where things are

- `web/shared/building.js`, `world.js`: the 3D model, surroundings, light and cameras
- `web/shared/story.js`: details to script
- `web/shared/film.js`: draws any moment of the film; used by both the preview and the final video
- `web/shared/shots.js`, `reel.js`, `reelfilm.js`: reel pictures, script and drawing
- `server/render.js`: video. `sound.js`, `voice-worker.js`, `music-worker.js`: sound. `footage.js`: image model
- `data/`: your projects. Back this folder up.
