namespace Plinth;

/// Where things are. The project root is the folder that holds web/index.html.
public static class Paths
{
    public static readonly string Root = FindRoot();
    public static string Web => Path.Combine(Root, "web");
    public static string Data => Path.Combine(Root, "data");
    public static string Models => Path.Combine(Root, "models");
    public static string Workers => Path.Combine(Root, "workers");
    public static string NodeModules(string p) => Path.Combine(Root, "node_modules", p);

    static string FindRoot()
    {
        if (Environment.GetEnvironmentVariable("PLINTH_ROOT") is { Length: > 0 } set) return set;
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
            for (var d = new DirectoryInfo(start); d != null; d = d.Parent)
                if (File.Exists(Path.Combine(d.FullName, "web", "index.html"))) return d.FullName;
        throw new InvalidOperationException("Run Plinth from inside its folder, or set PLINTH_ROOT.");
    }

    /// Reads .env. Variables already set in the environment win.
    public static void LoadEnv()
    {
        var f = Path.Combine(Root, ".env");
        if (!File.Exists(f)) return;
        foreach (var line in File.ReadAllLines(f))
        {
            var t = line.Trim();
            var eq = t.IndexOf('=');
            if (t.StartsWith('#') || eq < 1) continue;
            var key = t[..eq].Trim();
            var val = t[(eq + 1)..].Trim().Trim('"', '\'');
            if (Environment.GetEnvironmentVariable(key) is null) Environment.SetEnvironmentVariable(key, val);
        }
    }
}

/// An error whose message is meant for the person using the app.
public class AppError(string message, int status = 400, object? extra = null) : Exception(message)
{
    public int Status => status;
    public object? Extra => extra;
}
