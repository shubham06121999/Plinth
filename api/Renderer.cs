using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plinth;

/// Films, photos, posters and footage.
public sealed class Renderer
{
    static readonly Dictionary<string, (string Label, int W, int H)> Formats = new() { ["9:16"] = ("Vertical", 1080, 1920), ["1:1"] = ("Square", 1080, 1080), ["16:9"] = ("Wide", 1920, 1080) };
    static string Slug(string s) { var t = Regex.Replace(s.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-'); if (t.Length > 40) t = t[..40].Trim('-'); return t == "" ? "project" : t; }
    static string Temp() => Directory.CreateTempSubdirectory("plinth-").FullName;
    static void Clear(string dir) { try { Directory.Delete(dir, true); } catch (IOException) { } }

    public async Task Run(Job job, CancellationToken ct)
    {
        await using var chrome = await Chrome.Open(ct);
        switch (job.Kind)
        {
            case "film": await Film(job, chrome, ct); break;
            case "footage": await Shoot(job, chrome, job.Keys, job.Again, ct); break;
            default: await Stills(job, chrome, ct); break;
        }
    }

    /// Makes the pictures a reel needs. `only` limits it to some; otherwise whatever is missing.
    static async Task Shoot(Job job, Chrome chrome, string[]? only, bool again, CancellationToken ct)
    {
        var p = Store.Get(job.ProjectId);
        var have = p.Obj("footage");
        var keys = only ?? (await chrome.Ask("needed", p))!.AsArray().Select(k => k!.GetValue<string>()).ToArray();
        var want = keys.Where(k => Footage.IsShot(k) && (again || have[k] is null)).Distinct().ToArray();
        if (want.Length == 0) return;
        if (!Footage.Enabled) throw new AppError("The photoreal image model is not installed. Run \"npm run setup-ai\" in the plinth folder, or add your own pictures and clips.");
        var shots = (await chrome.Ask("shots", p, new JsonArray(want.Select(k => (JsonNode)k).ToArray())))!.AsArray().OfType<JsonObject>().ToList();
        var (w, h) = Footage.Size(p);
        var tmp = Temp();
        try
        {
            var refs = new Dictionary<string, string>();
            var withRef = shots.Where(s => s.Bool("ref")).Select(s => s.Str("key")).ToArray();
            if (withRef.Length > 0)
            {
                job.Step = "Setting up the camera angles";
                await chrome.Render(new() { ["project"] = job.ProjectId }, async (buf, q) =>
                {
                    var key = q["key"].ToString();
                    if (!withRef.Contains(key)) return;
                    await File.WriteAllBytesAsync(refs[key] = Path.Combine(tmp, key + ".jpg"), buf, ct);
                }, "(k, w, h) => window.plinth.refs(k, w, h)", withRef, w / 2, h / 2);
            }
            for (var i = 0; i < shots.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var s = shots[i];
                var key = s.Str("key");
                job.Step = $"Photographing {s.Str("label").ToLowerInvariant()}, {i + 1} of {shots.Count}";
                string id = Store.NewId(), png = Path.Combine(tmp, key + ".png"), media = Store.Media(job.ProjectId), file = id + ".jpg", dep = id + "-depth.png";
                var at = i;
                await Footage.Image(s.Str("prompt"), w, h, Convert.ToInt32(id[..6], 16) % 100000, refs.GetValueOrDefault(key), png, sub => job.Progress = (at + sub * 0.9) / shots.Count, ct);
                await Proc.Run("ffmpeg", ["-y", "-i", png, "-q:v", "2", Path.Combine(media, file)], ct);
                var deep = await Footage.Depth(png, Path.Combine(media, dep), ct);
                Store.Update(job.ProjectId, x =>
                {
                    var f = x.Obj("footage");
                    Footage.DropFiles(job.ProjectId, f[key] as JsonObject);
                    f[key] = new JsonObject { ["file"] = file, ["depth"] = deep ? dep : null, ["made"] = true };
                });
                job.Progress = (i + 1.0) / shots.Count;
            }
        }
        finally { Clear(tmp); }
    }

    static async Task Film(Job job, Chrome chrome, CancellationToken ct)
    {
        var p = Store.Get(job.ProjectId);
        var format = job.Format != null && Formats.ContainsKey(job.Format) ? job.Format : p.Obj("film").Str("format", "9:16");
        if (!Formats.TryGetValue(format, out var size)) (format, size) = ("9:16", Formats["9:16"]);
        var reel = p.Obj("film").Str("style", "reel") != "model";
        if (reel && Footage.Enabled) { await Shoot(job, chrome, null, false, ct); p = Store.Get(job.ProjectId); job.Progress = 0; }
        var tmp = Temp();
        try
        {
            job.Step = "Recording the narration";
            var lines = (await chrome.Ask(reel ? "reelSpeech" : "filmSpeech", reel ? [p] : [p, format]))!.AsArray();
            var voice = await Sound.Speak(p.Obj("film").Str("voice", "none"), lines, tmp, ct);

            JsonObject plan, timing = [], durations = [];
            JsonArray cues = [];
            if (reel)
            {
                foreach (var (k, v) in voice) timing[k] = new JsonObject { ["dur"] = v.Dur, ["parts"] = new JsonArray(v.Parts.Select(x => (JsonNode)x).ToArray()) };
                var r = (await chrome.Ask("reel", p, format, timing))!.AsObject();
                plan = r.Obj("plan");
                cues = r.Arr("cues");
            }
            else
            {
                foreach (var k in (await chrome.Ask("sceneKeys", p))!.AsArray()) { var key = k!.GetValue<string>(); durations[key] = voice.TryGetValue(key, out var v) ? v.Dur : 0; }
                plan = (await chrome.Ask("film", p, format, durations))!.AsObject();
            }
            var scenes = plan.Objects("scenes").ToList();
            if (scenes.Count == 0) throw new AppError("Every scene is switched off. Turn at least one on.");

            job.Step = "Composing and mixing the sound";
            var track = await Sound.Master(p, plan, cues, voice, tmp, ct);

            int fps = (int)plan.Num("fps", 30), frames = (int)Math.Floor(plan.Num("total") * fps + 0.5);
            var posterAt = (int)Math.Floor((scenes[0].Num("start") + scenes[0].Num("dur") - 0.8) * fps + 0.5);
            string mp4 = Path.Combine(tmp, "film.mp4");
            byte[]? poster = null;
            job.Step = "Filming";

            List<string> args = ["-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", $"{fps}", "-i", "pipe:0"];
            if (track != null) args.AddRange(["-i", track]);
            args.AddRange(["-map", "0:v"]);
            if (track != null) args.AddRange(["-map", "1:a", "-c:a", "copy"]);
            args.AddRange(["-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M", "-profile:v", "high",
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                "-movflags", "+faststart", "-r", $"{fps}", mp4]);
            using var ff = Proc.Start(Proc.Info("ffmpeg", args));
            using (ct.Register(() => Proc.Kill(ff)))
            {
                var err = new StringBuilder();
                var drainErr = Task.Run(async () => { string? l; while ((l = await ff.StandardError.ReadLineAsync(CancellationToken.None)) != null) { if (err.Length > 4000) err.Remove(0, 2000); err.AppendLine(l); } }, CancellationToken.None);
                var drainOut = ff.StandardOutput.ReadToEndAsync(CancellationToken.None);
                var n = 0;
                try
                {
                    await chrome.Render(new() { ["project"] = p.Str("id"), ["format"] = format, ["style"] = reel ? "reel" : "model", ["durations"] = durations.ToJsonString(), ["timing"] = timing.ToJsonString() },
                        async (buf, _) =>
                        {
                            if (ff.HasExited) throw new AppError("ffmpeg stopped early: " + Proc.Tail(err.ToString(), 1), 500);
                            if (n == posterAt) poster = buf;
                            n++;
                            job.Progress = (double)n / frames;
                            await ff.StandardInput.BaseStream.WriteAsync(buf, ct);
                        }, "() => window.plinth.film()");
                }
                catch (Exception e) when (!ct.IsCancellationRequested)
                {
                    Proc.Kill(ff);
                    throw e as AppError ?? new AppError("Filming stopped: " + e.Message.Split('\n')[0], 500);
                }
                ff.StandardInput.Close();
                job.Step = "Finishing the file";
                await ff.WaitForExitAsync(CancellationToken.None);
                await Task.WhenAll(drainErr, drainOut);
                ct.ThrowIfCancellationRequested();
                if (ff.ExitCode != 0) throw new AppError("ffmpeg failed: " + Proc.Tail(err.ToString(), 2), 500);
            }

            var id = Store.NewId();
            string dir = Store.Out(p.Str("id")), file = $"{Slug(p.Str("name"))}-{format.Replace(':', 'x')}-{id[..4]}.mp4", thumb = Path.ChangeExtension(file, ".jpg");
            File.Copy(mp4, Path.Combine(dir, file));
            if (poster != null) await File.WriteAllBytesAsync(Path.Combine(dir, thumb), poster, ct);
            Store.Update(p.Str("id"), x => x.Arr("outputs").Insert(0, new JsonObject
            {
                ["id"] = id, ["kind"] = "film", ["label"] = $"{size.Label} {(reel ? "reel" : "film")}", ["file"] = file, ["thumb"] = poster != null ? thumb : null,
                ["w"] = (int)plan.Num("w"), ["h"] = (int)plan.Num("h"), ["format"] = format, ["seconds"] = (int)Math.Floor(plan.Num("total") + 0.5),
                ["bytes"] = new FileInfo(Path.Combine(dir, file)).Length, ["createdAt"] = Store.Now(),
            }));
            job.Outputs.Enqueue(id);
        }
        finally { Clear(tmp); }
    }

    /// "photos" are views of the building; "posters" are views with the details set on them.
    static async Task Stills(Job job, Chrome chrome, CancellationToken ct)
    {
        var p = Store.Get(job.ProjectId);
        var photos = job.Kind == "photos";
        job.Step = photos ? "Photographing the model" : "Setting the posters";
        var made = new List<JsonObject>();
        var dir = Store.Out(job.ProjectId);
        await chrome.Render(new() { ["project"] = job.ProjectId }, async (buf, q) =>
        {
            string id = Store.NewId(), label = q["label"].ToString(), file = $"{Slug(p.Str("name"))}-{Slug(label)}-{id[..4]}.jpg";
            await File.WriteAllBytesAsync(Path.Combine(dir, file), buf, ct);
            made.Add(new JsonObject { ["id"] = id, ["kind"] = photos ? "photo" : "poster", ["label"] = label, ["file"] = file, ["thumb"] = file, ["w"] = int.Parse(q["w"]!), ["h"] = int.Parse(q["h"]!), ["bytes"] = buf.Length, ["createdAt"] = Store.Now() });
            job.Progress = made.Count / double.Parse(q["of"]!);
        }, "k => window.plinth.stills(k)", job.Kind);
        Store.Update(job.ProjectId, x => { var o = x.Arr("outputs"); for (var i = made.Count - 1; i >= 0; i--) o.Insert(0, made[i].DeepClone()); });
        foreach (var m in made) job.Outputs.Enqueue(m.Str("id"));
    }
}
