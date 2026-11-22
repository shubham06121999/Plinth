using System.Text.Json.Nodes;

namespace Plinth;

/// Composes the music bed and the sound effects for one film. Everything is synthesised here,
/// so there is no licence to clear.
public sealed class Music
{
    const int SR = 48000;
    const double TAU = Math.PI * 2;
    readonly int N;
    readonly float[][] dry, wet, sfx, drums;
    readonly List<double> kicks = [];
    uint seed = 11;

    sealed record Mood(double Bpm, int Root, int[][] Chords, int[] Bass, double Drive);
    static readonly Dictionary<string, Mood> Moods = new()
    {
        ["uplift"] = new(104, 62, [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], [0, 9, 5, 7], 1),
        ["warm"] = new(88, 60, [[0, 4, 7, 14], [9, 12, 16, 19], [5, 9, 12, 16], [7, 12, 14, 17]], [0, 9, 5, 7], 0.6),
        ["cinematic"] = new(76, 57, [[0, 3, 7, 12], [8, 12, 15, 20], [3, 7, 10, 15], [10, 14, 17, 22]], [0, 8, 3, 10], 0.45),
    };

    Music(double total)
    {
        N = (int)Math.Ceiling((total + 0.6) * SR);
        float[][] bus() => [new float[N], new float[N]];
        dry = bus(); wet = bus(); sfx = bus(); drums = bus();
    }

    /// Writes the two files. `drop` is the moment the full arrangement enters.
    public static void Compose(double total, string mood, double drop, JsonArray cues, string musicFile, string sfxFile)
    {
        var m = new Music(total);
        if (Moods.TryGetValue(mood, out var md)) m.Arrange(md, total, drop);
        foreach (var e in cues.OfType<JsonObject>()) m.Cue(e);
        var rv = new[] { m.Reverb(m.wet[0], 0), m.Reverb(m.wet[1], 23) };
        // Dip everything low out of the reverb so it never muddies the voice.
        foreach (var ch in rv)
        {
            double lp = 0, k = 1 - Math.Exp(-TAU * 260 / SR);
            for (var i = 0; i < m.N; i++) { lp += k * (ch[i] - lp); ch[i] = (float)(ch[i] - lp); }
        }
        float[] each(Func<int, double> f) { var o = new float[m.N]; for (var i = 0; i < m.N; i++) o[i] = (float)f(i); return o; }
        float[][] two(Func<int, int, double> f) => [each(i => f(0, i)), each(i => f(1, i))];
        m.Save(musicFile, two((c, i) => Math.Tanh((m.dry[c][i] + m.drums[c][i] * 0.9) * 1.15) + rv[c][i] * 0.55));
        m.Save(sfxFile, two((c, i) => Math.Tanh(m.sfx[c][i] * 1.1)));
    }

    // ---- building blocks ----------------------------------------------------
    double Rnd() { seed = (uint)((ulong)seed * 1664525 + 1013904223); return seed / 4294967296.0 * 2 - 1; }
    static double Hz(double note) => 440 * Math.Pow(2, (note - 69) / 12);
    static double A(double x, double a) => Math.Min(1, x / a);

    void Put(float[][] b, double t0, double dur, double pan, Func<double, double> fn, double send = 0)
    {
        int a = Math.Max(0, (int)Math.Floor(t0 * SR)), e = Math.Min(N, (int)Math.Floor((t0 + dur) * SR));
        double l = Math.Cos((pan + 1) * Math.PI / 4), r = Math.Sin((pan + 1) * Math.PI / 4);
        for (var i = a; i < e; i++)
        {
            var v = fn(Math.Max(0, (double)i / SR - t0));
            b[0][i] = (float)(b[0][i] + v * l); b[1][i] = (float)(b[1][i] + v * r);
            if (send > 0) { wet[0][i] = (float)(wet[0][i] + v * l * send); wet[1][i] = (float)(wet[1][i] + v * r * send); }
        }
    }

    // Trapezoidal state-variable band-pass: stable at any cutoff.
    Func<double?, double> Noise(double fc, double q)
    {
        double z1 = 0, z2 = 0, k = 1 / q;
        return f =>
        {
            double g = Math.Tan(Math.PI * Math.Min(f ?? fc, 18000) / SR), a1 = 1 / (1 + g * (g + k)), v3 = Rnd() - z2;
            double v1 = a1 * z1 + g * a1 * v3, v2 = z2 + g * v1;
            z1 = 2 * v1 - z1; z2 = 2 * v2 - z2;
            return v1 * k;
        };
    }

    // ---- instruments --------------------------------------------------------
    void Keys(double t, double note, double v, double pan = 0, double d = 2.6) // soft felt piano
    {
        double f = Hz(note), br = Math.Min(1, v * 1.1);
        var n = Noise(1800, 1);
        Put(dry, t, d, pan, x =>
        {
            double s = 0;
            for (var k = 1; k <= 7; k++)
            {
                var fk = f * k * Math.Sqrt(1 + 0.0004 * k * k);
                if (fk > 9000) break;
                s += Math.Sin(TAU * fk * x + k) * Math.Exp(-x * (1.1 + k * 0.75 + f / 900)) * Math.Pow(br, k - 1) / k;
            }
            return (s + n(null) * Math.Exp(-x * 90) * 0.1) * A(x, 0.003) * A(d - x, 0.2) * v * 0.2;
        }, 0.38);
    }
    void Pluck(double t, double note, double v, double pan)
    {
        var f = Hz(note);
        Put(dry, t, 1.1, pan, x => (Math.Sin(TAU * f * x + 1.8 * Math.Exp(-x * 14) * Math.Sin(TAU * f * 2 * x)) + 0.3 * Math.Sin(TAU * f * 3 * x) * Math.Exp(-x * 16)) * Math.Exp(-x * 5.2) * A(x, 0.002) * v * 0.13, 0.5);
    }
    static readonly double[] Detune = [0.9965, 1, 1.0042];
    void Pad(double t, double note, double d, double v, double pan)
    {
        var f = Hz(note);
        Put(dry, t, d, pan, x =>
        {
            double s = 0, p = 1.7 - 0.25 * Math.Sin(x * 0.9);
            foreach (var q in Detune) for (var k = 1; k <= 5; k++) s += Math.Sin(TAU * f * q * k * x + q * 40 + k) / Math.Pow(k, p);
            return s * A(x, 0.9) * A(d - x, 0.9) * v * 0.028;
        }, 0.45);
    }
    void Bass(double t, double note, double d, double v)
    {
        var f = Hz(note);
        Put(dry, t, d, 0, x => Math.Tanh(1.7 * (Math.Sin(TAU * f * x) + 0.35 * Math.Sin(TAU * 2 * f * x))) * A(x, 0.012) * A(d - x, 0.08) * Math.Exp(-x * 0.7) * v * 0.2);
    }
    void Kick(double t, double v)
    {
        kicks.Add(t);
        Put(drums, t, 0.4, 0, x => (Math.Sin(TAU * (46 * x + 7.2 * (1 - Math.Exp(-x * 26)))) * Math.Exp(-x * 8.5) + Rnd() * Math.Exp(-x * 320) * 0.25) * v * 0.62);
    }
    void Clap(double t, double v)
    {
        var n = Noise(1700, 0.9);
        Put(drums, t, 0.3, 0, x => n(null) * (Math.Exp(-x * 24) + (x < 0.012 || (x > 0.016 && x < 0.026) ? 0.6 : 0)) * v * 0.34, 0.25);
    }
    void Hat(double t, double v, bool open)
    {
        var n = Noise(9000, 0.7);
        Put(drums, t, open ? 0.22 : 0.07, 0.25, x => n(null) * Math.Exp(-x * (open ? 16 : 70)) * v * 0.16);
    }

    static readonly (double E, int I)[] Motif = [(0, 2), (1.5, 1), (2.5, 3), (4, 2), (5.5, 0), (6.5, 1)];
    static readonly (double Q, double D, double V)[] BassLine = [(0, 1.4, 1), (1.5, 0.5, 0.7), (2, 1.4, 0.9), (3.5, 0.5, 0.7)];
    static readonly double[] HatV = [0.35, 0.2, 0.8, 0.25];

    void Arrange(Mood M, double total, double drop)
    {
        double beat = 60 / M.Bpm, bar = beat * 4, first = drop % bar;
        // Bars are placed so that a downbeat lands exactly where the project is introduced.
        if (first > 0.02) first -= bar;
        var k = -(int)Math.Floor((drop - first) / bar + 0.5);
        for (var t = first; t < total; t += bar, k++)
        {
            var slot = (k % 4 + 4) % 4;
            var c = M.Chords[slot];
            var b = M.Root - 24 + M.Bass[slot];
            bool live = t >= drop - 0.05, last = t + bar > total - 2.4, big = k >= 4;
            var lift = Math.Min(1, 0.7 + t / total * 0.4);
            for (var j = 0; j < 4; j++) Pad(t, M.Root - 12 + c[j], bar + 0.8, live ? 0.75 : 1, (j - 1.5) * 0.4);
            if (last)
            {
                for (var j = 0; j < 4; j++) Keys(t + j * 0.04, M.Root - 12 + c[j], 0.7, (j - 1.5) * 0.2, 4);
                Bass(t, b, bar * 1.2, 0.8);
                continue;
            }
            for (var j = 0; j < 4; j++) Keys(t + j * 0.012, M.Root - 12 + c[j], 0.55 * lift, (j - 1.5) * 0.25);
            if (big || !live) Keys(t + beat * 2, M.Root - 12 + c[2], 0.34, 0.2);
            if (!live) continue;
            foreach (var (e, i) in Motif) Pluck(t + e * beat / 2, M.Root + c[i % 4] + (big && e > 3 ? 12 : 0), 0.62 * lift, e % 2 != 0 ? 0.45 : -0.4);
            foreach (var (q, d, v) in BassLine) Bass(t + q * beat, b + (q == 3.5 ? 12 : 0), d * beat, v * 0.85);
            for (var q = 0; q < 4; q++)
            {
                if (M.Drive > 0.5 || q % 2 == 0) Kick(t + q * beat, M.Drive * (q % 2 != 0 ? 0.75 : 1));
                if (q % 2 != 0 && big) Clap(t + q * beat, M.Drive * 0.8);
                for (var e = 0; e < 4; e++) Hat(t + (q + e / 4.0) * beat, M.Drive * HatV[e] * (big ? 1 : 0.6), e == 2 && q == 3 && big);
            }
        }
        // Music breathes with the kick.
        foreach (var kt in kicks)
        {
            int a = Math.Max(0, (int)Math.Floor(kt * SR)), e = Math.Min(N, a + (int)Math.Floor(0.26 * SR));
            for (var i = a; i < e; i++)
            {
                var g = 1 - 0.3 * M.Drive * Math.Pow(1 - (double)(i - a) / (e - a), 1.5);
                dry[0][i] = (float)(dry[0][i] * g); dry[1][i] = (float)(dry[1][i] * g);
            }
        }
    }

    // ---- effects --------------------------------------------------------------
    void Cue(JsonObject e)
    {
        double t = e.Num("t"), v = e.Num("v", 1), d = e.Num("d", 1.4);
        switch (e.Str("type"))
        {
            case "whoosh": Whoosh(t, v, e.Num("dir", 1)); break;
            case "impact": Impact(t, v); break;
            case "riser": Riser(t - d, d, v); break;
            case "chime": Chime(t, v); break;
            case "pop": Put(sfx, t, 0.14, 0, x => Math.Sin(TAU * (420 * x + 6 * (1 - Math.Exp(-x * 40)))) * Math.Exp(-x * 34) * A(x, 0.002) * v * 0.22, 0.12); break;
            case "count":
                for (var i = 0; i < 14; i++)
                {
                    var n = Noise(5200, 3);
                    Put(sfx, t + 0.72 * (1 - Math.Pow(1 - i / 14.0, 2.2)), 0.03, 0.1, x => n(null) * Math.Exp(-x * 220) * 0.5 * 0.3);
                }
                break;
        }
    }
    void Whoosh(double t, double v, double dir)
    {
        foreach (var s in new[] { -1, 1 })
        {
            var n = Noise(600, 1.1);
            const double d = 0.62;
            Put(sfx, t - 0.34, d, s * 0.5, x =>
            {
                double k = x / d, e = Math.Pow(Math.Sin(Math.PI * Math.Pow(k, 0.8)), 2), bal = 0.5 + 0.5 * s * dir * (k * 2 - 1);
                return n(350 + 4200 * Math.Pow(Math.Sin(Math.PI * k), 2)) * e * bal * v * 0.5;
            }, 0.2);
        }
    }
    void Impact(double t, double v)
    {
        var n = Noise(300, 0.8);
        Put(sfx, t, 1.5, 0, x => (Math.Sin(TAU * (34 * x + 5 * (1 - Math.Exp(-x * 9)))) * Math.Exp(-x * 2.8) + n(null) * Math.Exp(-x * 15) * 0.5) * A(x, 0.002) * v * 0.62, 0.3);
    }
    void Riser(double t, double d, double v)
    {
        if (d <= 0) return;
        var n = Noise(500, 1.4);
        Put(sfx, t, d, 0, x =>
        {
            var k = x / d;
            return (n(400 + 7000 * k * k) * 0.5 + Math.Sin(TAU * (180 * x + 260 * x * x / d)) * 0.1) * k * k * A(d - x, 0.02) * v * 0.32;
        }, 0.3);
    }
    static readonly int[] ChimeNotes = [0, 4, 7, 12, 16];
    void Chime(double t, double v)
    {
        for (var i = 0; i < ChimeNotes.Length; i++)
        {
            var f = Hz(86 + ChimeNotes[i]);
            Put(sfx, t + i * 0.05, 1.9, (i - 2) * 0.3, x => (Math.Sin(TAU * f * x) + 0.45 * Math.Sin(TAU * f * 2.76 * x) * Math.Exp(-x * 7)) * Math.Exp(-x * 3.2) * A(x, 0.002) * v * 0.07, 0.7);
        }
    }

    // Plate-style reverb for everything sent to `wet`.
    float[] Reverb(float[] inp, int offs)
    {
        var o = new float[N];
        int len(int d) => (int)Math.Floor((d + offs) * (double)SR / 44100 + 0.5);
        foreach (var d in new[] { 1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116 })
        {
            var b = new float[len(d)];
            var i = 0;
            double f = 0;
            for (var n = 0; n < N; n++)
            {
                double y = b[i];
                f = y * 0.72 + f * 0.28;
                b[i] = (float)(inp[n] + f * 0.86);
                if (++i >= b.Length) i = 0;
                o[n] = (float)(o[n] + y * 0.125);
            }
        }
        foreach (var d in new[] { 225, 556, 441, 341 })
        {
            var b = new float[len(d)];
            var i = 0;
            for (var n = 0; n < N; n++)
            {
                double y = b[i], x = o[n];
                b[i] = (float)(x + y * 0.5);
                o[n] = (float)(y - x * 0.5);
                if (++i >= b.Length) i = 0;
            }
        }
        return o;
    }

    void Save(string file, float[][] ch)
    {
        double pk = 0.001;
        foreach (var c in ch) foreach (var x in c) pk = Math.Max(pk, Math.Abs(x));
        var g = Math.Min(0.8 / pk, 4);
        using var w = new BinaryWriter(File.Create(file));
        w.Write("RIFF"u8); w.Write((uint)(36 + N * 4)); w.Write("WAVEfmt "u8); w.Write(16u);
        w.Write((ushort)1); w.Write((ushort)2); w.Write((uint)SR); w.Write((uint)(SR * 4)); w.Write((ushort)4); w.Write((ushort)16);
        w.Write("data"u8); w.Write((uint)(N * 4));
        for (var i = 0; i < N; i++) { w.Write((short)(ch[0][i] * g * 32767)); w.Write((short)(ch[1][i] * g * 32767)); }
    }
}
