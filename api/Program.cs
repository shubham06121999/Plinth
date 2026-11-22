using System.Net;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Plinth;

Paths.LoadEnv();
if (args.Contains("sample")) { Sample.Add(); return; }
var port = int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var set) ? set : 4600;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = Paths.Root, WebRootPath = Paths.Web });
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Extensions.Hosting.Internal.Host", LogLevel.None);
builder.WebHost.ConfigureKestrel(k =>
{
    k.Listen(IPAddress.Loopback, port);
    k.Limits.MaxRequestBodySize = 2_000_000;
    k.Limits.MinRequestBodyDataRate = null;
});
builder.Services.AddSingleton<Renderer>();
builder.Services.AddSingleton<JobQueue>();
builder.Services.AddHostedService(s => s.GetRequiredService<JobQueue>());
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(6));
var app = builder.Build();
var jobs = app.Services.GetRequiredService<JobQueue>();

// Every failure reaches the browser as { error }.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception e) when (!ctx.Response.HasStarted)
    {
        var (status, message, extra) = e switch
        {
            AppError a => (a.Status, a.Message, a.Extra),
            BadHttpRequestException b => (b.StatusCode, b.StatusCode == 413 ? "That file is too large." : b.Message, null),
            System.Text.Json.JsonException => (400, "That was not valid JSON.", null),
            OperationCanceledException => (499, "Cancelled", null),
            _ => (500, e.Message, null),
        };
        if (status >= 500) app.Logger.LogError(e, "{Path}", ctx.Request.Path);
        ctx.Response.StatusCode = status;
        await ctx.Response.WriteAsJsonAsync(extra is null ? new { error = message } : (object)new { error = message, fields = extra });
    }
});

// Local tool: only this machine, only this origin.
app.Use(async (ctx, next) =>
{
    var origin = ctx.Request.Headers.Origin.ToString();
    if (ctx.Request.Host.Host is not ("localhost" or "127.0.0.1") || (origin != "" && origin != $"http://{ctx.Request.Host}")) { ctx.Response.StatusCode = 403; return; }
    await next();
});

var types = new FileExtensionContentTypeProvider();
types.Mappings[".mjs"] = "text/javascript";
void Serve(string at, string dir) { if (Directory.Exists(dir)) app.UseStaticFiles(new StaticFileOptions { RequestPath = at, FileProvider = new PhysicalFileProvider(dir), ContentTypeProvider = types }); }
Serve("/vendor/three", Paths.NodeModules("three"));
Serve("/vendor/fonts/archivo", Paths.NodeModules("@fontsource-variable/archivo"));
Serve("/vendor/fonts/shoulders", Paths.NodeModules("@fontsource-variable/big-shoulders-display"));
Serve("/vendor/fonts/marcellus", Paths.NodeModules("@fontsource/marcellus"));
Serve("/vendor/fonts/vibes", Paths.NodeModules("@fontsource/great-vibes"));
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = types, OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache" });
app.UseRouting();

app.MapGet("/files/{id}/{box}/{name}", (string id, string box, string name, HttpContext ctx) =>
{
    if (box is not ("media" or "out") || name != Path.GetFileName(name) || name.StartsWith('.')) return Results.NotFound();
    var f = Path.Combine(Store.Dir(id), box, name);
    if (!File.Exists(f)) return Results.NotFound();
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    var type = types.TryGetContentType(f, out var t) ? t : "application/octet-stream";
    return Results.File(f, type, ctx.Request.Query.ContainsKey("dl") ? name : null, enableRangeProcessing: true, lastModified: File.GetLastWriteTimeUtc(f));
});

// ---- projects ------------------------------------------------------------------
var api = app.MapGroup("/api");
async Task<JsonObject> Body(HttpContext c)
{
    if (c.Request.ContentLength is null or 0) return [];
    if (!c.Request.HasJsonContentType()) throw new AppError("Send JSON.", 415);
    return await JsonNode.ParseAsync(c.Request.Body) as JsonObject ?? [];
}
async Task<byte[]> Raw(HttpContext c, long limitMb)
{
    c.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = limitMb * 1_000_000;
    using var m = new MemoryStream();
    await c.Request.Body.CopyToAsync(m);
    return m.ToArray();
}

api.MapGet("/status", async () => Results.Json(new JsonObject
{
    ["browser"] = Chrome.Find() != null, ["ffmpeg"] = await Works("ffmpeg"), ["voices"] = await Sound.Voices(), ["footage"] = Footage.Enabled, ["photoreal"] = Photoreal.Enabled,
}));
api.MapGet("/projects", () => Results.Json(new JsonArray(Store.List().Select(p => (JsonNode)p).ToArray())));
// The cast matters: a handler taking only HttpContext would otherwise bind as a RequestDelegate and drop its result.
api.MapPost("/projects", (Delegate)(async (HttpContext c) => Results.Json(Store.Create(await Body(c)))));
api.MapGet("/projects/{id}", (string id) => Results.Json(Store.Get(id)));
api.MapPut("/projects/{id}", async (string id, HttpContext c) => { var b = await Body(c); return Results.Json(Store.Update(id, p => Store.Apply(p, b))); });
api.MapDelete("/projects/{id}", (string id) => { Store.Get(id); jobs.StopProject(id); Store.Remove(id); return Results.Json(new { ok = true }); });

// ---- pictures, logo, music -------------------------------------------------------
api.MapPost("/projects/{id}/photos", async (string id, string? name, HttpContext c) =>
{
    var (pic, file) = await SaveImage(id, name, await Raw(c, 40));
    return Results.Json(Store.Update(id, p => { var a = p.Arr("photos"); a.Add(new JsonObject { ["id"] = pic, ["file"] = file, ["caption"] = "", ["inFilm"] = a.OfType<JsonObject>().Count(x => x.Bool("inFilm")) < 8 }); }));
});
api.MapDelete("/projects/{id}/photos/{photo}", (string id, string photo) => Results.Json(Store.Update(id, p =>
{
    if (p.Objects("photos").FirstOrDefault(x => x.Str("id") == photo) is { } ph) File.Delete(Path.Combine(Store.Media(id), ph.Str("file")));
    p.Arr("photos").Drop(x => x.Str("id") == photo);
    if (p.Str("posterPhoto") == photo) p["posterPhoto"] = "";
})));
api.MapPost("/projects/{id}/logo", async (string id, string? name, HttpContext c) =>
{
    var (_, file) = await SaveImage(id, name, await Raw(c, 15), png: true);
    return Results.Json(Store.Update(id, p => { DropMedia(id, p.Str("logo")); p["logo"] = file; }));
});
api.MapDelete("/projects/{id}/logo", (string id) => Results.Json(Store.Update(id, p => { DropMedia(id, p.Str("logo")); p["logo"] = null; })));
api.MapPost("/projects/{id}/track", async (string id, string? name, HttpContext c) =>
{
    Store.Get(id);
    var ext = Path.GetExtension(name ?? "").ToLowerInvariant();
    if (ext is not (".mp3" or ".m4a" or ".wav" or ".aac" or ".ogg" or ".flac")) throw new AppError("Use an MP3, M4A, WAV, AAC, OGG or FLAC file.");
    string file = Store.NewId() + ext, full = Path.Combine(Store.Media(id), file);
    await File.WriteAllBytesAsync(full, await Raw(c, 40));
    double dur = 0;
    try { dur = await Sound.Seconds(full); } catch (AppError) { }
    if (dur <= 0) { File.Delete(full); throw new AppError("That file has no audio we can read."); }
    return Results.Json(Store.Update(id, p => { DropMedia(id, p.Str("track")); p["track"] = file; p.Obj("film")["music"] = "upload"; }));
});

// Your own picture or clip in place of a generated one.
api.MapPost("/projects/{id}/footage/{key}", async (string id, string key, string? name, HttpContext c) =>
{
    if (!Footage.IsShot(key)) throw new AppError("Unknown shot");
    var p0 = Store.Get(id);
    var dir = Store.Media(id);
    var data = await Raw(c, 300);
    JsonObject rec;
    if (Regex.IsMatch(name ?? "", @"\.(mp4|mov|m4v|webm)$", RegexOptions.IgnoreCase))
    {
        var (w, h) = p0.Obj("film").Str("format") switch { "1:1" => (1080, 1080), "16:9" => (1920, 1080), _ => (1080, 1920) };
        string clip = Store.NewId(), src = Path.Combine(dir, $".{clip}{Path.GetExtension(name!).ToLowerInvariant()}");
        await File.WriteAllBytesAsync(src, data);
        try { await Proc.Run("ffmpeg", ["-y", "-i", src, "-t", "8", "-vf", $"fps=30,scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}", "-q:v", "3", Path.Combine(dir, clip + "-%04d.jpg")]); }
        catch (AppError) { throw new AppError($"{name} could not be read as a video."); }
        finally { File.Delete(src); }
        var frames = Directory.GetFiles(dir, clip + "-*.jpg").Length;
        if (frames == 0) throw new AppError($"{name} has no picture we can read.");
        rec = new JsonObject { ["clip"] = clip, ["frames"] = frames, ["thumb"] = clip + "-0001.jpg" };
    }
    else
    {
        var (pic, file) = await SaveImage(id, name, data);
        var dep = pic + "-depth.png";
        rec = new JsonObject { ["file"] = file, ["depth"] = await Footage.Depth(Path.Combine(dir, file), Path.Combine(dir, dep)) ? dep : null };
    }
    return Results.Json(Store.Update(id, p => { var f = p.Obj("footage"); Footage.DropFiles(id, f[key] as JsonObject); f[key] = rec; }));
});
api.MapDelete("/projects/{id}/footage/{key}", (string id, string key) => Results.Json(Store.Update(id, p => { var f = p.Obj("footage"); Footage.DropFiles(id, f[key] as JsonObject); f.Remove(key); })));

// ---- making things ----------------------------------------------------------------
api.MapPost("/projects/{id}/jobs", async (string id, HttpContext c) =>
{
    var p = Store.Get(id);
    var b = await Body(c);
    var kind = b.Str("kind");
    if (kind is not ("film" or "photos" or "posters" or "footage")) throw new AppError("Unknown kind");
    var gaps = Store.Missing(p);
    if (gaps.Count > 0) throw new AppError($"Add the {string.Join(" and ", gaps.Select(g => g.Label))} first.", 400, gaps.Select(g => g.Field).ToArray());
    var keys = b["keys"] is JsonArray a ? a.Select(k => k?.ToString() ?? "").Where(Footage.IsShot).ToArray() : null;
    return Results.Json(jobs.Add(new Job(id, kind, b["format"]?.ToString(), keys, b.Bool("again"))).ToJson());
});
api.MapGet("/jobs", (string? project) => Results.Json(new JsonArray(jobs.For(project ?? "").Select(j => (JsonNode)j.ToJson()).ToArray())));
api.MapPost("/jobs/{id}/cancel", (string id) => { jobs.Stop(id); return Results.Json(new { ok = true }); });

api.MapDelete("/projects/{id}/outputs/{o}", (string id, string o) => Results.Json(Store.Update(id, p =>
{
    if (p.Objects("outputs").FirstOrDefault(x => x.Str("id") == o) is { } found)
        foreach (var f in new[] { found.Str("file"), found.Str("thumb") }) if (f != "") File.Delete(Path.Combine(Store.Out(id), f));
    p.Arr("outputs").Drop(x => x.Str("id") == o);
})));
api.MapPost("/projects/{id}/outputs/{o}/photoreal", async (string id, string o) =>
    Photoreal.Enabled ? Results.Json(await Photoreal.Make(id, o)) : throw new AppError("Add OPENAI_API_KEY to .env and restart."));
api.MapPost("/projects/{id}/outputs/{o}/use", (string id, string o) => Results.Json(Store.Update(id, p =>
{
    var src = p.Objects("outputs").FirstOrDefault(x => x.Str("id") == o && x.Str("kind") == "photo") ?? throw new AppError("That image no longer exists", 404);
    string pic = Store.NewId(), file = pic + Path.GetExtension(src.Str("file"));
    File.Copy(Path.Combine(Store.Out(id), src.Str("file")), Path.Combine(Store.Media(id), file));
    // Views carry their own label; a photoreal version may have lost it.
    p.Arr("photos").Add(new JsonObject { ["id"] = pic, ["caption"] = "", ["inFilm"] = true, ["file"] = file, ["cgi"] = src.Bool("photoreal") });
})));

app.MapPost("/internal/sink/{token}", async (string token, HttpContext c) => { await Chrome.Deliver(token, await Raw(c, 60), c.Request.Query); return Results.Ok(); });

Chrome.Origin = $"http://127.0.0.1:{port}";
try
{
    await app.StartAsync();
    Console.WriteLine($"Plinth is running at http://localhost:{port}");
    await app.WaitForShutdownAsync();
}
catch (IOException e) when (e.InnerException is Microsoft.AspNetCore.Connections.AddressInUseException || e.Message.Contains("in use"))
{
    Console.Error.WriteLine($"Port {port} is in use. Set PORT in .env.");
    Environment.ExitCode = 1;
}

// ---- helpers ------------------------------------------------------------------------
static async Task<bool> Works(string cmd) { try { await Proc.Run(cmd, ["-version"]); return true; } catch (AppError) { return false; } }
static void DropMedia(string id, string file) { if (file != "") File.Delete(Path.Combine(Store.Media(id), file)); }
static async Task<(string Id, string File)> SaveImage(string project, string? name, byte[] data, bool png = false)
{
    Store.Get(project);
    if (!Regex.IsMatch(name ?? "", @"\.(jpe?g|png|webp|heic|heif|avif|tiff?)$", RegexOptions.IgnoreCase))
        throw new AppError($"{(string.IsNullOrEmpty(name) ? "That file" : name)} is not a photo we can read. Use JPG, PNG, WebP or HEIC.");
    var dir = Store.Media(project);
    var id = Store.NewId();
    string src = Path.Combine(dir, $".{id}{Path.GetExtension(name!).ToLowerInvariant()}"), file = $"{id}.{(png ? "png" : "jpg")}", o = Path.Combine(dir, file);
    await File.WriteAllBytesAsync(src, data);
    try
    {
        if (OperatingSystem.IsMacOS())
        {
            List<string> a = ["-s", "format", png ? "png" : "jpeg"];
            if (!png) a.AddRange(["-s", "formatOptions", "90"]);
            await Proc.Run("sips", [.. a, "--resampleHeightWidthMax", png ? "800" : "2400", src, "--out", o]);
        }
        else await Proc.Run("ffmpeg", ["-y", "-i", src, "-frames:v", "1", "-q:v", "2", o]);
    }
    catch (AppError) { /* reported below */ }
    finally { File.Delete(src); }
    return File.Exists(o) ? (id, file) : throw new AppError($"{name} could not be read as an image.");
}
