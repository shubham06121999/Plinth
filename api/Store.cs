using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plinth;

/// Projects, one folder each, as JSON. Kept as JsonObject so fields the front end adds survive untouched.
public static class Store
{
    static readonly object Gate = new();
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    // The browser only ever owns these fields. Photos, footage and outputs are the server's, so an
    // autosave can never wipe a film that finished a second earlier. Mirrors EDITABLE in web/shared/model.js.
    static readonly string[] Editable =
    [
        "name", "developer", "tagline", "type", "stage", "possession", "land", "units", "rera",
        "locality", "city", "address", "phone", "email", "website", "priceFrom", "offer",
        "configs", "connectivity", "amenities", "building", "film", "brand", "posterPhoto",
    ];

    static JsonObject Blank() => JsonNode.Parse("""
        { "name": "", "developer": "", "tagline": "", "type": "apartments", "stage": "prelaunch", "possession": "",
          "land": "", "units": "", "rera": "", "locality": "", "city": "", "address": "",
          "phone": "", "email": "", "website": "", "priceFrom": "", "offer": "",
          "configs": [], "connectivity": [], "amenities": [], "brand": "#E8552D",
          "building": { "towers": 2, "floors": 18, "style": "balcony", "wall": "#EFEAE0", "trim": "#5B4636", "setting": "city", "pool": true, "podium": true },
          "film": { "style": "reel", "format": "9:16", "theme": "modern", "light": "arc", "voice": "kokoro:af_heart", "music": "uplift", "scenes": {}, "reel": {}, "gold": "#FFD21F", "viewNote": "", "lookNote": "" },
          "posterPhoto": "", "photos": [], "logo": null, "track": null, "outputs": [], "footage": {}, "voiceover": {} }
        """)!.AsObject();

    public static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
    static bool OkId(string id) => Regex.IsMatch(id, @"\A[a-f0-9]{12}\z");

    public static string Dir(string id) => OkId(id) ? Path.Combine(Paths.Data, id) : throw new AppError("Project not found", 404);
    public static string Media(string id) { var d = Path.Combine(Dir(id), "media"); Directory.CreateDirectory(d); return d; }
    public static string Out(string id) { var d = Path.Combine(Dir(id), "out"); Directory.CreateDirectory(d); return d; }
    static string FileOf(string id) => Path.Combine(Dir(id), "project.json");

    public static JsonObject Get(string id)
    {
        lock (Gate)
        {
            var f = FileOf(id);
            if (!File.Exists(f)) throw new AppError("Project not found", 404);
            return JsonNode.Parse(File.ReadAllText(f))!.AsObject();
        }
    }

    static JsonObject Save(JsonObject p)
    {
        p["updatedAt"] = Now();
        var f = FileOf(p.Str("id"));
        File.WriteAllText(f + ".tmp", p.ToJsonString(Json));
        File.Move(f + ".tmp", f, true);
        return p;
    }

    public static JsonObject Create(JsonObject? fields)
    {
        lock (Gate)
        {
            var p = Blank();
            p["id"] = NewId();
            p["createdAt"] = Now();
            Media(p.Str("id")); Out(p.Str("id"));
            return Save(Apply(p, fields ?? []));
        }
    }

    public static JsonObject Update(string id, Action<JsonObject> change)
    {
        lock (Gate) { var p = Get(id); change(p); return Save(p); }
    }

    public static JsonObject Apply(JsonObject p, JsonObject fields)
    {
        foreach (var k in Editable) if (fields.ContainsKey(k)) p[k] = fields[k]?.DeepClone();
        if (fields["photos"] is JsonArray sent)
        {
            var own = p.Arr("photos").OfType<JsonObject>().ToList();
            var next = new JsonArray();
            foreach (var f in sent.OfType<JsonObject>())
            {
                var mine = own.FirstOrDefault(x => x.Str("id") == f.Str("id"));
                if (mine is null) continue;
                own.Remove(mine);
                var caption = f.Str("caption");
                mine["caption"] = caption.Length > 120 ? caption[..120] : caption;
                mine["inFilm"] = f.Bool("inFilm");
                next.Add(mine.DeepClone());
            }
            foreach (var rest in own) next.Add(rest.DeepClone());
            p["photos"] = next;
        }
        p.Obj("footage"); p.Obj("voiceover");
        return p;
    }

    public static List<JsonObject> List()
    {
        lock (Gate)
        {
            Directory.CreateDirectory(Paths.Data);
            return Directory.GetDirectories(Paths.Data).Select(d => Path.GetFileName(d)!)
                .Where(d => OkId(d) && File.Exists(FileOf(d))).Select(Get)
                .OrderByDescending(p => p.Str("updatedAt"), StringComparer.Ordinal).ToList();
        }
    }

    public static void Remove(string id) { lock (Gate) { Get(id); Directory.Delete(Dir(id), true); } }

    /// What has to be there before a film says anything useful.
    public static List<(string Field, string Label)> Missing(JsonObject p)
    {
        var o = new List<(string, string)>();
        if (p.Str("name").Trim() == "") o.Add(("name", "project name"));
        if (p.Str("locality").Trim() == "" && p.Str("city").Trim() == "") o.Add(("locality", "location"));
        return o;
    }
}

public static class JsonX
{
    public static string Str(this JsonObject o, string k, string or = "") => o[k] is JsonValue v ? v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.GetValueKind() is JsonValueKind.Null ? or : v.ToString() : or;
    public static bool Bool(this JsonObject o, string k) => o[k] is JsonValue v && v.GetValueKind() == JsonValueKind.True;
    public static double Num(this JsonObject o, string k, double or = 0) => o[k] is JsonValue v && double.TryParse(v.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : or;
    public static JsonArray Arr(this JsonObject o, string k) { if (o[k] is JsonArray a) return a; var n = new JsonArray(); o[k] = n; return n; }
    public static JsonObject Obj(this JsonObject o, string k) { if (o[k] is JsonObject a) return a; var n = new JsonObject(); o[k] = n; return n; }
    public static IEnumerable<JsonObject> Objects(this JsonObject o, string k) => o[k] is JsonArray a ? a.OfType<JsonObject>() : [];
    public static void Drop(this JsonArray a, Func<JsonObject, bool> match) { foreach (var x in a.OfType<JsonObject>().Where(match).ToList()) a.Remove(x); }
}
