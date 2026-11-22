using System.Buffers.Binary;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace Plinth;

/// Optional. Sends one generated view to OpenAI and asks for a photoreal version of the same
/// building. Runs only when the user presses the button and a key is in .env.
public static class Photoreal
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };
    static string? Env(string k) => Environment.GetEnvironmentVariable(k) is { Length: > 0 } v ? v : null;
    public static bool Enabled => Env("OPENAI_API_KEY") != null;

    public static async Task<JsonObject> Make(string projectId, string outputId)
    {
        var p = Store.Get(projectId);
        var src = p.Objects("outputs").FirstOrDefault(o => o.Str("id") == outputId && o.Str("kind") == "photo") ?? throw new AppError("That image no longer exists", 404);
        var b = p.Obj("building");
        var style = b.Str("style") switch { "glass" => "Glass curtain", "classic" => "Classic", "green" => "Planted terraces", _ => "Wide balconies" };
        var around = b.Str("setting") switch { "suburb" => "Suburb", "hills" => "Hills", "water" => "Waterfront", _ => "City" };
        var dir = Store.Out(projectId);
        using var form = new MultipartFormDataContent();
        void field(string k, string v) => form.Add(new StringContent(v), k);
        field("model", Env("OPENAI_IMAGE_MODEL") ?? "gpt-image-1");
        field("size", src.Num("w") > src.Num("h") ? "1536x1024" : "1024x1536");
        field("quality", "high");
        field("prompt", $"Turn this 3D model view into a photorealistic architectural visualisation. Keep the camera, the number of buildings, the number of floors, the massing, the time of day and the layout exactly as shown. {style} facade, {around} surroundings. Real materials, natural vegetation, believable light. No text, no logos, no watermark.");
        var img = new ByteArrayContent(await File.ReadAllBytesAsync(Path.Combine(dir, src.Str("file"))));
        img.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(img, "image", "view.jpg");
        using var req = new HttpRequestMessage(HttpMethod.Post, Env("OPENAI_URL") ?? "https://api.openai.com/v1/images/edits") { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Env("OPENAI_API_KEY"));
        using var r = await Http.SendAsync(req);
        JsonNode? j = null;
        try { j = JsonNode.Parse(await r.Content.ReadAsStringAsync()); } catch (System.Text.Json.JsonException) { }
        if (!r.IsSuccessStatusCode) throw new AppError("OpenAI said: " + (j?["error"]?["message"]?.ToString() ?? $"{(int)r.StatusCode}"), 502);
        var b64 = j?["data"]?[0]?["b64_json"]?.ToString() ?? throw new AppError("OpenAI sent no image back", 502);
        var buf = Convert.FromBase64String(b64);
        string id = Store.NewId(), file = $"{Path.GetFileNameWithoutExtension(src.Str("file"))}-photoreal-{id[..4]}.png";
        await File.WriteAllBytesAsync(Path.Combine(dir, file), buf);
        var rec = new JsonObject
        {
            ["id"] = id, ["kind"] = "photo", ["label"] = src.Str("label") + ", photoreal", ["file"] = file, ["thumb"] = file,
            ["w"] = BinaryPrimitives.ReadInt32BigEndian(buf.AsSpan(16)), ["h"] = BinaryPrimitives.ReadInt32BigEndian(buf.AsSpan(20)),
            ["bytes"] = buf.Length, ["createdAt"] = Store.Now(), ["photoreal"] = true,
        };
        Store.Update(projectId, x => x.Arr("outputs").Insert(0, rec.DeepClone()));
        return rec;
    }
}
