using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using PuppeteerSharp;

namespace Plinth;

/// A headless Chrome for one job. It runs the same drawing code as the studio preview, and answers
/// questions about the script so those rules exist only once.
public sealed class Chrome : IAsyncDisposable
{
    static readonly string?[] Browsers =
    [
        Environment.GetEnvironmentVariable("CHROME_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        @"C:\Program Files\Google\Chrome\Application\chrome.exe", @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ];
    public static string? Find() => Browsers.FirstOrDefault(b => !string.IsNullOrEmpty(b) && File.Exists(b));
    public static string Origin { get; set; } = "";

    // Where frames and stills posted by a render page go, by one-time token.
    static readonly ConcurrentDictionary<string, Func<byte[], IQueryCollection, Task>> Sinks = new();
    public static Task Deliver(string token, byte[] data, IQueryCollection q) =>
        Sinks.TryGetValue(token, out var fn) ? fn(data, q) : throw new AppError("No such render", 404);

    readonly IBrowser browser;
    readonly CancellationTokenRegistration reg;
    IPage? logic;

    Chrome(IBrowser b, CancellationToken ct) { browser = b; reg = ct.Register(() => _ = Close()); }
    async Task Close() { try { await browser.CloseAsync(); } catch { /* already closed */ } }
    public async ValueTask DisposeAsync() { await reg.DisposeAsync(); await Close(); await browser.DisposeAsync(); }

    public static async Task<Chrome> Open(CancellationToken ct)
    {
        var exe = Find() ?? throw new AppError("Rendering needs Google Chrome, Edge, Brave or Chromium. Install one, or set CHROME_PATH in .env.");
        List<string> args = ["--hide-scrollbars", "--mute-audio", "--ignore-gpu-blocklist", "--enable-gpu"];
        if (OperatingSystem.IsMacOS()) args.Add("--use-angle=metal");
        var b = await Puppeteer.LaunchAsync(new LaunchOptions { ExecutablePath = exe, Headless = true, Args = [.. args], ProtocolTimeout = 30 * 60_000 });
        if (ct.IsCancellationRequested) { await b.CloseAsync(); ct.ThrowIfCancellationRequested(); }
        return new Chrome(b, ct);
    }

    /// Calls window.logic.<fn>(project, ...args) and returns its answer.
    public async Task<JsonNode?> Ask(string fn, params JsonNode?[] args)
    {
        if (logic is null)
        {
            logic = await browser.NewPageAsync();
            await logic.GoToAsync(Origin + "/logic.html");
            await logic.WaitForFunctionAsync("() => window.logic", new WaitForFunctionOptions { Timeout = 20_000 });
        }
        var json = new JsonArray(args.Select(a => a?.DeepClone()).ToArray()).ToJsonString();
        var s = await logic.EvaluateFunctionAsync<string>("(fn, json) => JSON.stringify(window.logic[fn](...JSON.parse(json)) ?? null)", fn, json);
        return JsonNode.Parse(s);
    }

    /// Opens the render page, hands what it posts to `sink`, and runs `script` to completion.
    public async Task Render(Dictionary<string, string> query, Func<byte[], IQueryCollection, Task> sink, string script, params object[] args)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        Sinks[token] = sink;
        var page = await browser.NewPageAsync();
        try
        {
            var errors = new ConcurrentQueue<string>();
            page.PageError += (_, e) => errors.Enqueue(e.Message);
            page.Console += (_, e) => { if (e.Message.Type == ConsoleType.Error) errors.Enqueue(e.Message.Text); };
            query["token"] = token;
            await page.GoToAsync($"{Origin}/render.html?" + string.Join('&', query.Select(q => $"{q.Key}={Uri.EscapeDataString(q.Value)}")), new NavigationOptions { Timeout = 60_000, WaitUntil = [WaitUntilNavigation.Load] });
            try { await page.WaitForFunctionAsync("() => window.plinth && window.plinth.ready", new WaitForFunctionOptions { Timeout = 60_000 }); }
            catch (WaitTaskTimeoutException) { throw new AppError("The renderer did not start: " + (errors.TryPeek(out var e) ? e : "timed out"), 500); }
            await page.EvaluateFunctionAsync(script, args);
        }
        finally
        {
            Sinks.TryRemove(token, out _);
            try { await page.CloseAsync(); } catch { /* browser already closed */ }
        }
    }
}
