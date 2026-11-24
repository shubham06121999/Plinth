# Plinth

Turn the details of an upcoming real-estate project into a narrated film, views of the building and ready-to-post posters. Everything runs on this computer.

## Start

Needs the .NET 8 SDK, Node 20 or later, ffmpeg, and Chrome, Edge, Brave or Chromium.

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

## Your own voice

Under Film, set Voice to **Your own voice, recorded or uploaded**. Then either:

- **Record:** press **Record all lines**. Each line appears large, like a teleprompter. Press the space bar to start and again to stop, and the next line comes up. Any line can be recorded again on its own.
- **Upload:** use **Upload** next to a line, for example a file from your phone or from a voice artist. Use one file per line.

Plinth takes out rumble and steady background hiss, evens the level of every line and trims the silence. It keeps the character of the voice. The captions follow your pace, and on lines shown over several cards each card changes where you pause. Lines without a recording are silent. If you change a line after recording it, Plinth asks you to record it again.

For the best sound, record in a small room with soft furnishings, about a hand's width from the microphone. A wired headset or a phone held close sounds better than a laptop's built-in microphone.

## Voices and music

The offline AI voices speak English. Mac voices, including Hindi, are also listed. Music and effects are composed by the app, so they need no licence. You can use your own track. Finished sound is set to about -14 LUFS, the level social apps expect.

## Photoreal images (optional)

Copy `.env.example` to `.env`, set `OPENAI_API_KEY` and restart. A "Make photoreal" button appears on each view. Pressing it sends that image and your facade and surroundings settings to OpenAI, which charges per image. Check the result before using it: an AI image can change the design or lose the label.

## Where things are

- `api/`: the ASP.NET Core backend
  - `Program.cs`: the API. `Store.cs`: projects. `Jobs.cs`: the render queue
  - `Renderer.cs`, `Chrome.cs`: films, photos and posters, drawn in headless Chrome and encoded by ffmpeg
  - `Sound.cs`, `Music.cs`: narration, music, effects and the final mix. `Footage.cs`: the image model
- `workers/`: two small Node programs for the offline voice and picture depth
- `web/`: the studio. `web/shared/` holds the 3D model, the script rules and the drawing code, used by both the preview and the finished video. The backend asks `logic.html` for the script instead of keeping a second copy
- `data/`: your projects. Back this folder up.

To move to a newer .NET, install its SDK and change `TargetFramework` in `api/Plinth.Api.csproj`.
