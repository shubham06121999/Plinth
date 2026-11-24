using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plinth;

/// Real voices: a line recorded in the studio or uploaded, cleaned up gently so it still sounds like
/// a person in a room, trimmed, levelled, and measured so captions land on the words.
public static class Voiceover
{
    const int Rate = 24000;
    static readonly Regex Ext = new(@"\.(webm|ogg|opus|mp3|m4a|mp4|aac|wav|flac|caf|aiff?)$", RegexOptions.IgnoreCase);

    /// `lengths` is the character count of each part of the line, for timing a line shown on several cards.
    public static async Task<JsonObject> Save(string projectId, string key, string? name, byte[] data, string say, int[] lengths)
    {
        Store.Get(projectId);
        if (!Regex.IsMatch(key, @"\A[a-z0-9_-]{1,40}\z")) throw new AppError("Unknown line");
        if (!Ext.IsMatch(name ?? "")) throw new AppError($"{(string.IsNullOrEmpty(name) ? "That file" : name)} is not a recording we can read. Use M4A, MP3, WAV or the recorder.");
        var dir = Store.Media(projectId);
        var tmp = Directory.CreateTempSubdirectory("plinth-vo-").FullName;
        try
        {
            string src = Path.Combine(tmp, "in" + Path.GetExtension(name!).ToLowerInvariant()), clean = Path.Combine(tmp, "clean.wav");
            await File.WriteAllBytesAsync(src, data);
            // Light touch: rumble out, steady background hiss down, a little less boom and a little more
            // clarity, sibilance softened, peaks evened. Nothing that changes the character of the voice.
            try
            {
                await Proc.Run("ffmpeg", ["-y", "-i", src, "-vn", "-ac", "1", "-ar", "48000", "-af",
                    "highpass=f=70,afftdn=nr=14:nf=-50:tn=1,equalizer=f=240:t=q:w=1.2:g=-2,equalizer=f=4200:t=q:w=1.4:g=1.5," +
                    "deesser=i=0.3,acompressor=threshold=-22dB:ratio=2.4:attack=8:release=160:makeup=2dB", "-c:a", "pcm_f32le", clean]);
            }
            catch (AppError) { throw new AppError($"{name} has no audio we can read."); }
            var pcm = await Samples(clean);
            if (pcm.Length < Rate / 3) throw new AppError("That recording is too short.");
            if (pcm.Length > Rate * 90) throw new AppError("Keep each line under a minute and a half.");

            var (from, to) = Trim(pcm);
            if (to - from < Rate / 4) throw new AppError("That recording sounds silent. Check the microphone and try again.");
            // Every line comes out at the same loudness, so no line jumps out of the mix.
            var log = (await Proc.Try("ffmpeg", ["-hide_banner", "-ss", S(from), "-to", S(to), "-i", clean, "-af", "ebur128", "-f", "null", "-"])).Err;
            var m = Regex.Matches(log, @"I:\s+(-?[\d.]+) LUFS");
            var gain = m.Count > 0 && double.TryParse(m[^1].Groups[1].Value, out var lu) && lu > -70 ? Math.Clamp(-19 - lu, -20, 24) : 0;
            string id = Store.NewId(), file = $"vo-{id}.wav";
            await Proc.Run("ffmpeg", ["-y", "-ss", S(from), "-to", S(to), "-i", clean, "-af", $"volume={gain:F2}dB,afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse,alimiter=limit=0.9:level=disabled", "-ar", "48000", "-c:a", "pcm_s16le", Path.Combine(dir, file)]);

            var part = pcm[from..to];
            var rec = new JsonObject
            {
                ["file"] = file, ["dur"] = Math.Round((double)part.Length / Rate, 3),
                ["parts"] = new JsonArray(Ends(part, lengths).Select(e => (JsonNode)Math.Round(e, 3)).ToArray()),
                ["say"] = say, ["madeAt"] = Store.Now(),
            };
            return Store.Update(projectId, p => { var v = p.Obj("voiceover"); Drop(projectId, v[key] as JsonObject); v[key] = rec; });
        }
        finally { try { Directory.Delete(tmp, true); } catch (IOException) { } }
    }

    public static JsonObject Remove(string projectId, string key) =>
        Store.Update(projectId, p => { var v = p.Obj("voiceover"); Drop(projectId, v[key] as JsonObject); v.Remove(key); });

    static void Drop(string projectId, JsonObject? rec) { if (rec?.Str("file") is { Length: > 0 } f) File.Delete(Path.Combine(Store.Media(projectId), f)); }
    static string S(int sample) => ((double)sample / Rate).ToString("F3");

    static async Task<float[]> Samples(string file)
    {
        var info = Proc.Info("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", $"{Rate}", "-f", "f32le", "-"]);
        using var p = Proc.Start(info);
        p.StandardInput.Close();
        using var ms = new MemoryStream();
        var err = p.StandardError.ReadToEndAsync();
        await p.StandardOutput.BaseStream.CopyToAsync(ms);
        await p.WaitForExitAsync(); await err;
        var bytes = ms.ToArray();
        var o = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, o, 0, o.Length * 4);
        return o;
    }

    static double[] Frames(float[] a, int size)
    {
        var e = new double[a.Length / size];
        for (var f = 0; f < e.Length; f++) { double s = 0; for (var i = f * size; i < (f + 1) * size; i++) s += a[i] * a[i]; e[f] = Math.Sqrt(s / size); }
        return e;
    }

    /// Start and end of the speech, with a little air either side.
    static (int From, int To) Trim(float[] a)
    {
        const int size = Rate / 100; // 10 ms
        var e = Frames(a, size);
        if (e.Length == 0) return (0, 0);
        var sorted = e.OrderBy(x => x).ToArray();
        double floor = sorted[(int)(sorted.Length * 0.1)], loud = sorted[(int)(sorted.Length * 0.95)];
        var gate = Math.Max(floor * 3, loud * 0.08);
        // Ignore clicks: speech means a few loud frames in a row.
        int first = -1, last = -1;
        for (var f = 0; f + 3 < e.Length; f++) if (e[f] > gate && e[f + 1] > gate && e[f + 2] > gate) { first = f; break; }
        for (var f = e.Length - 1; f >= 3; f--) if (e[f] > gate && e[f - 1] > gate && e[f - 2] > gate) { last = f; break; }
        if (first < 0 || last <= first) return (0, 0);
        return (Math.Max(0, first * size - Rate / 8), Math.Min(a.Length, (last + 1) * size + Rate / 4));
    }

    /// Where each part ends: shared out by length, then moved to the quietest moment nearby, which is
    /// where a speaker pauses between phrases.
    static double[] Ends(float[] a, int[] lengths)
    {
        var total = (double)a.Length / Rate;
        if (lengths.Length <= 1) return [total];
        const int size = Rate / 50; // 20 ms
        var e = Frames(a, size);
        double sum = lengths.Sum(l => l + 4.0), acc = 0;
        var o = new double[lengths.Length];
        for (var i = 0; i < lengths.Length; i++)
        {
            acc += lengths[i] + 4;
            if (i == lengths.Length - 1) { o[i] = total; break; }
            var guess = (int)(e.Length * acc / sum);
            int best = guess, lo = Math.Max(1, guess - 20), hi = Math.Min(e.Length - 2, guess + 20);
            var low = double.MaxValue;
            for (var f = lo; f <= hi; f++)
            {
                var q = (e[f - 1] + e[f] + e[f + 1]) * (1 + Math.Abs(f - guess) / 60.0);
                if (q < low) { low = q; best = f; }
            }
            o[i] = Math.Max(i > 0 ? o[i - 1] + 0.2 : 0.2, (best + 0.5) * size / Rate);
        }
        return o;
    }
}
