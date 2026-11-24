using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plinth;

/// Narration, and the final mix: voice polish, music that steps back for the voice, effects,
/// and a master at the loudness social apps expect.
public static class Sound
{
    public sealed record Line(string File, double Dur, double[] Parts);

    static readonly (string Id, string Label)[] Kokoro =
    [
        ("af_heart", "Heart, American"), ("af_bella", "Bella, American"), ("af_nicole", "Nicole, soft American"), ("bf_emma", "Emma, British"),
        ("af_kore", "Kore, American"), ("am_michael", "Michael, American"), ("am_fenrir", "Fenrir, deep American"), ("bm_george", "George, British"),
    ];
    // The novelty voices macOS ships are no use in an ad, so this is a short list.
    static readonly string[] Good = ["Rishi", "Tara", "Aman", "Lekha", "Daniel", "Samantha", "Karen", "Moira", "Veena", "Isha", "Neel", "Kiyara"];
    static List<(string Id, string Lang)>? mac;

    static async Task<List<(string Id, string Lang)>> MacVoices()
    {
        if (mac != null) return mac;
        string o;
        try { o = await Proc.Run("say", ["-v", "?"]); } catch (AppError) { o = ""; }
        int rank(string id) { var i = Array.IndexOf(Good, id); return i; }
        return mac = o.Split('\n').Select(l => Regex.Match(l, @"^(.+?)\s+([a-z]{2}_[A-Z0-9]{2,3})\s+#")).Where(m => m.Success)
            .Select(m => (Id: m.Groups[1].Value.Trim(), Lang: m.Groups[2].Value.Replace('_', '-')))
            .Where(v => Good.Contains(Regex.Replace(v.Id, @" \(.*$", "")) || Regex.IsMatch(v.Id, @"\((Premium|Enhanced)\)"))
            .OrderBy(v => rank(v.Id)).ToList();
    }

    public static async Task<JsonArray> Voices()
    {
        var a = new JsonArray { new JsonObject { ["id"] = "own", ["label"] = "Your own voice, recorded or uploaded" } };
        if (Footage.VoiceReady) foreach (var (id, label) in Kokoro) a.Add(new JsonObject { ["id"] = "kokoro:" + id, ["label"] = label });
        foreach (var v in await MacVoices()) a.Add(new JsonObject { ["id"] = v.Id, ["label"] = $"{v.Id}, Mac voice ({v.Lang})" });
        return a;
    }

    public static async Task<double> Seconds(string file, CancellationToken ct = default) =>
        double.TryParse((await Proc.Run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], ct)).Trim(), out var d) ? d : 0;

    /// Speaks each entry ({ key, parts: [] }) and reports where each part of it ends.
    public static async Task<Dictionary<string, Line>> Speak(JsonObject p, string voice, JsonArray entries, string dir, CancellationToken ct)
    {
        var res = new Dictionary<string, Line>();
        if (voice == "none" || entries.Count == 0) return res;
        if (voice == "own")
        {
            // Lines without a recording stay silent.
            var media = Store.Media(p.Str("id"));
            foreach (var e in entries.OfType<JsonObject>())
                if (p.Obj("voiceover")[e.Str("key")] is JsonObject r && File.Exists(Path.Combine(media, r.Str("file"))))
                    res[e.Str("key")] = new(Path.Combine(media, r.Str("file")), r.Num("dur"), r.Arr("parts").Select(x => x!.GetValue<double>()).ToArray());
            return res;
        }
        if (voice.StartsWith("kokoro:"))
        {
            var name = voice[7..];
            if (!Footage.VoiceReady || Kokoro.All(k => k.Id != name)) throw new AppError("That voice is not installed. Run \"npm run setup-ai\" in the plinth folder, or choose another voice.");
            string jf = Path.Combine(dir, "voice.json"), of = Path.Combine(dir, "voice-out.json");
            var job = new JsonObject { ["models"] = Paths.Models, ["voice"] = name, ["dir"] = dir, ["out"] = of, ["beats"] = entries.DeepClone() };
            await File.WriteAllTextAsync(jf, job.ToJsonString(), ct);
            await Proc.Run("node", [Path.Combine(Paths.Workers, "voice-worker.js"), jf], ct);
            foreach (var (key, v) in JsonNode.Parse(await File.ReadAllTextAsync(of, ct))!.AsObject())
                res[key] = new(v!["file"]!.GetValue<string>(), v["dur"]!.GetValue<double>(), v["parts"]!.AsArray().Select(x => x!.GetValue<double>()).ToArray());
            return res;
        }
        if ((await MacVoices()).All(v => v.Id != voice)) return res;
        foreach (var e in entries.OfType<JsonObject>())
        {
            var key = e.Str("key");
            var files = new List<string>();
            var ends = new List<double>();
            double t = 0;
            foreach (var part in e.Arr("parts"))
            {
                string txt = Path.Combine(dir, $"{key}-{files.Count}.txt"), wav = Path.Combine(dir, $"{key}-{files.Count}.wav");
                await File.WriteAllTextAsync(txt, part!.GetValue<string>(), ct);
                await Proc.Run("say", ["-v", voice, "-r", "172", "-f", txt, "-o", wav, "--data-format=LEI16@24000"], ct);
                t += await Seconds(wav, ct);
                ends.Add(t); files.Add(wav);
            }
            string file = Path.Combine(dir, key + ".wav"), list = Path.Combine(dir, key + ".lst");
            await File.WriteAllLinesAsync(list, files.Select(f => $"file '{f}'"), ct);
            await Proc.Run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", file], ct);
            res[key] = new(file, t, [.. ends]);
        }
        return res;
    }

    static string F(double v, int places = 3) => v.ToString("F" + places);

    /// Music, effects and voice into one finished track. Returns null when there is nothing to hear.
    public static async Task<string?> Master(JsonObject p, JsonObject plan, JsonArray cues, Dictionary<string, Line> voice, string dir, CancellationToken ct)
    {
        var film = p.Obj("film");
        var total = plan.Num("total");
        var scenes = plan.Objects("scenes").ToList();
        string mood = film.Str("music"), musicWav = Path.Combine(dir, "music.wav"), sfxWav = Path.Combine(dir, "sfx.wav");
        var effects = film.ContainsKey("effects") && !film.Bool("effects") ? [] : cues;
        var drop = scenes.FirstOrDefault(s => s.Str("key") == "intro")?.Num("start") ?? 0;
        await Task.Run(() => Music.Compose(total, mood, drop, effects, musicWav, sfxWav), ct);
        ct.ThrowIfCancellationRequested();
        string? music = mood switch
        {
            "upload" => p.Str("track") is { Length: > 0 } t ? Path.Combine(Store.Media(p.Str("id")), t) : null,
            "none" => null,
            _ => musicWav,
        };
        var lines = scenes.Where(s => voice.ContainsKey(s.Str("key"))).ToList();
        if (music is null && lines.Count == 0 && effects.Count == 0) return null;

        var T = F(total);
        var inputs = new List<string>();
        var f = new List<string>();
        for (var i = 0; i < lines.Count; i++)
        {
            inputs.AddRange(["-i", voice[lines[i].Str("key")].File]);
            var ms = Math.Floor((lines[i].Num("start") + lines[i].Num("lead", 0.45)) * 1000 + 0.5);
            f.Add($"[{i}:a]aresample=48000:resampler=soxr,aformat=channel_layouts=mono,adelay={ms}[v{i}]");
        }
        var n = lines.Count;
        var voiced = n > 0;
        // A real recording is already cleaned and has its own room: leave its character alone.
        var natural = film.Str("voice") == "own";
        var mix = new List<string>();
        if (voiced)
        {
            f.Add($"{string.Concat(Enumerable.Range(0, n).Select(i => $"[v{i}]"))}amix=inputs={n}:normalize=0,apad,atrim=0:{T}," +
                (natural ? "highpass=f=70,acompressor=threshold=-20dB:ratio=1.8:attack=12:release=180:makeup=3dB,"
                         : "highpass=f=85,equalizer=f=260:t=q:w=1.1:g=-2.5,equalizer=f=3200:t=q:w=1:g=2.5,treble=g=1.5:f=8000,aexciter=amount=1.1:drive=5:freq=7200:ceil=15000,acompressor=threshold=-20dB:ratio=3.2:attack=6:release=110:makeup=5dB,") +
                "aformat=channel_layouts=stereo,asplit=3[va][vb][vc]");
            // A short, quiet room around the voice keeps it from sounding pasted on.
            f.Add(natural ? "[vc]anullsink" : "[vc]highpass=f=400,aecho=0.8:0.5:23|41|67:0.16|0.11|0.07,volume=0.35[room]");
            f.Add(natural ? "[va]anull[vox]" : "[va][room]amix=inputs=2:normalize=0[vox]");
            mix.Add("[vox]");
        }
        if (music != null)
        {
            inputs.AddRange(["-stream_loop", "-1", "-i", music]);
            f.Add($"[{n++}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{T},asetpts=PTS-STARTPTS,{(voiced ? "equalizer=f=2600:t=q:w=0.8:g=-3," : "")}volume={(voiced ? "0.36" : "0.9")},afade=t=in:d=0.25,afade=t=out:st={F(Math.Max(0, total - 1.6))}:d=1.6[m0]");
            if (voiced) f.Add("[m0][vb]sidechaincompress=threshold=0.02:ratio=5:attack=25:release=380:makeup=1[mus]");
            mix.Add(voiced ? "[mus]" : "[m0]");
        }
        else if (voiced) f.Add("[vb]anullsink");
        if (effects.Count > 0)
        {
            inputs.AddRange(["-i", sfxWav]);
            f.Add($"[{n}:a]atrim=0:{T},volume=0.38[fx]");
            mix.Add("[fx]");
        }
        f.Add($"{string.Concat(mix)}amix=inputs={mix.Count}:normalize=0,acompressor=threshold=-9dB:ratio=1.6:attack=20:release=160[out]");
        string raw = Path.Combine(dir, "raw.wav"), o = Path.Combine(dir, "mix.m4a");
        await Proc.Run("ffmpeg", ["-y", .. inputs, "-filter_complex", string.Join(';', f), "-map", "[out]", "-t", T, "-c:a", "pcm_f32le", "-ar", "48000", raw], ct);
        // Measure once, then set the level with plain gain and a limiter: no pumping.
        var log = (await Proc.Try("ffmpeg", ["-hide_banner", "-i", raw, "-af", "ebur128", "-f", "null", "-"], ct)).Err;
        var m = Regex.Matches(log, @"I:\s+(-?[\d.]+) LUFS");
        var loud = m.Count > 0 && double.TryParse(m[^1].Groups[1].Value, out var l) ? l : -18;
        await Proc.Run("ffmpeg", ["-y", "-i", raw, "-af", $"volume={F(-13.5 - loud, 2)}dB,aresample=192000,alimiter=limit=0.76:attack=4:release=60:level=disabled,aresample=48000", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", o], ct);
        return o;
    }
}
