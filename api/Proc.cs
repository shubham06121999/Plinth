using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace Plinth;

/// Runs outside programs. Arguments are always a list, never a shell string.
public static class Proc
{
    public static ProcessStartInfo Info(string cmd, IEnumerable<string> args)
    {
        var i = new ProcessStartInfo(cmd) { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, WorkingDirectory = Paths.Root };
        foreach (var a in args) i.ArgumentList.Add(a);
        return i;
    }

    public static Process Start(ProcessStartInfo info)
    {
        try { return Process.Start(info)!; }
        catch (Win32Exception) { throw new AppError($"{Path.GetFileName(info.FileName)} is not installed", 500); }
    }

    /// Returns stdout; throws with the last lines of stderr if the program fails.
    public static async Task<string> Run(string cmd, IEnumerable<string> args, CancellationToken ct = default, Action<string>? onErr = null, IDictionary<string, string>? env = null)
    {
        var (code, stdout, stderr) = await Try(cmd, args, ct, onErr, env);
        if (code != 0) throw new AppError($"{Path.GetFileName(cmd)} failed: {Tail(stderr, 3)}", 500);
        return stdout;
    }

    public static async Task<(int Code, string Out, string Err)> Try(string cmd, IEnumerable<string> args, CancellationToken ct = default, Action<string>? onErr = null, IDictionary<string, string>? env = null)
    {
        var info = Info(cmd, args);
        if (env != null) foreach (var (k, v) in env) info.Environment[k] = v;
        using var p = Start(info);
        p.StandardInput.Close();
        using var reg = ct.Register(() => Kill(p));
        var so = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var err = new StringBuilder();
        var buf = new char[1024];
        // Read in pieces rather than lines: progress bars rewrite one line.
        for (int n; (n = await p.StandardError.ReadAsync(buf)) > 0;)
        {
            var s = new string(buf, 0, n);
            err.Append(s);
            onErr?.Invoke(s);
        }
        var o = await so;
        await p.WaitForExitAsync(CancellationToken.None);
        ct.ThrowIfCancellationRequested();
        return (p.ExitCode, o, err.ToString());
    }

    public static void Kill(Process p) { try { if (!p.HasExited) p.Kill(true); } catch { /* already gone */ } }
    public static string Tail(string s, int lines) => string.Join(' ', s.Trim().Split('\n').TakeLast(lines)).Trim();
}
