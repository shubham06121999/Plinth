using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plinth;

/// Photoreal pictures made on this Mac: the 3D model's own views (so the building stays the same
/// building) and rooms described in words, turned into photographs by an open image model.
public static class Footage
{
    static string Snapshots => Path.Combine(Paths.Models, "hf/hub/models--Runpod--FLUX.2-klein-4B-mflux-4bit/snapshots");
    static string Bin(string n) => Path.Combine(Paths.Root, "ai/bin", n);
    static string? ModelDir => Directory.Exists(Snapshots) ? Directory.GetDirectories(Snapshots).FirstOrDefault() : null;
    public static bool Enabled => ModelDir != null && File.Exists(Bin("mflux-generate-flux2"));
    public static bool DepthReady => File.Exists(Path.Combine(Paths.Models, "onnx-community/depth-anything-v2-small/onnx/model.onnx"));
    public static bool VoiceReady => File.Exists(Path.Combine(Paths.Models, "onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx"));

    // The shot names live in the front end's shot list.
    static readonly Lazy<HashSet<string>> Keys = new(() =>
        Regex.Matches(File.ReadAllText(Path.Combine(Paths.Web, "shared/shots.js")), @"^  (\w+):\s+\{ label:", RegexOptions.Multiline).Select(m => m.Groups[1].Value).ToHashSet());
    public static bool IsShot(string key) => Keys.Value.Contains(key);

    public static (int W, int H) Size(JsonObject p) => p.Obj("film").Str("format") switch { "1:1" => (1280, 1280), "16:9" => (1920, 1088), _ => (1088, 1920) };

    public static async Task Image(string prompt, int w, int h, int seed, string? reference, string file, Action<double> progress, CancellationToken ct)
    {
        List<string> args = ["--model", ModelDir!, "--base-model", "flux2-klein-4b", "--prompt", prompt, "--width", $"{w}", "--height", $"{h}", "--steps", "4", "--guidance", "1.0", "--seed", $"{seed}", "--vae-tiling", "--no-exif", "--output", file];
        if (reference != null) args.AddRange(["--image-paths", reference]);
        var env = new Dictionary<string, string> { ["HF_HOME"] = Path.Combine(Paths.Models, "hf"), ["HF_HUB_OFFLINE"] = "1" };
        var (code, _, err) = await Proc.Try(Bin(reference != null ? "mflux-generate-flux2-edit" : "mflux-generate-flux2"), args, ct,
            s => { var m = Regex.Matches(s, @"(\d)/4 "); if (m.Count > 0) progress((m[^1].Groups[1].Value[0] - '0') / 4.0); }, env);
        if (code != 0 || !File.Exists(file)) throw new AppError("The image model stopped: " + Proc.Tail(err, 1), 500);
    }

    /// How near each part of a picture is, saved as a greyscale image. False if it could not be worked out.
    public static async Task<bool> Depth(string image, string file, CancellationToken ct = default)
    {
        if (!DepthReady) return false;
        try { await Proc.Run("node", [Path.Combine(Paths.Workers, "depth-worker.js"), Paths.Models, image, file], ct); return File.Exists(file); }
        catch (AppError e) { Console.Error.WriteLine("[depth] " + e.Message); return false; }
    }

    public static void DropFiles(string projectId, JsonObject? f)
    {
        if (f is null) return;
        var dir = Store.Media(projectId);
        foreach (var k in new[] { "file", "depth" }) if (f.Str(k) is { Length: > 0 } x) File.Delete(Path.Combine(dir, x));
        for (var i = 1; i <= (int)f.Num("frames"); i++) File.Delete(Path.Combine(dir, $"{f.Str("clip")}-{i:0000}.jpg"));
    }
}
