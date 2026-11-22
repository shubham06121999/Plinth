using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace Plinth;

public sealed class Job(string projectId, string kind, string? format, string[]? keys, bool again)
{
    public string Id { get; } = Store.NewId();
    public string ProjectId => projectId;
    public string Kind => kind;
    public string? Format => format;
    public string[]? Keys => keys;
    public bool Again => again;
    public volatile string Status = "queued";
    public volatile string Step = "Waiting for the render before it";
    public volatile string? Error;
    public double Progress;
    public readonly ConcurrentQueue<string> Outputs = new();
    public long CreatedAt { get; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public readonly CancellationTokenSource Cancel = new();
    public bool Busy => Status is "queued" or "running";

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["id"] = Id, ["projectId"] = ProjectId, ["kind"] = Kind, ["status"] = Status, ["step"] = Step, ["progress"] = Progress, ["outputs"] = new JsonArray(Outputs.Select(x => (JsonNode)x).ToArray()), ["createdAt"] = CreatedAt };
        if (Error != null) o["error"] = Error;
        return o;
    }
}

/// One job at a time: a render uses the whole machine.
public sealed class JobQueue(Renderer renderer, ILogger<JobQueue> log) : BackgroundService
{
    readonly Channel<Job> line = Channel.CreateUnbounded<Job>();
    readonly ConcurrentDictionary<string, Job> all = new();
    readonly object gate = new();

    public IEnumerable<Job> For(string project) => all.Values.Where(j => j.ProjectId == project).OrderBy(j => j.CreatedAt);

    public Job Add(Job job)
    {
        lock (gate)
        {
            if (all.Values.Any(j => j.ProjectId == job.ProjectId && j.Kind == job.Kind && j.Busy)) throw new AppError("That is already being made.", 409);
            var old = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 6 * 3600_000;
            foreach (var j in all.Values.Where(j => !j.Busy && j.CreatedAt < old)) all.TryRemove(j.Id, out _);
            all[job.Id] = job;
        }
        line.Writer.TryWrite(job);
        return job;
    }

    public void Stop(string id)
    {
        if (!all.TryGetValue(id, out var j) || !j.Busy) return;
        j.Status = "cancelled";
        j.Cancel.Cancel();
    }

    public void StopProject(string project) { foreach (var j in For(project).ToList()) Stop(j.Id); }

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        using var onStop = stopping.Register(() => { foreach (var j in all.Values) j.Cancel.Cancel(); });
        await foreach (var job in line.Reader.ReadAllAsync(stopping))
        {
            if (job.Status == "cancelled") continue;
            job.Status = "running";
            try
            {
                await renderer.Run(job, job.Cancel.Token);
                if (job.Status == "running") { job.Progress = 1; job.Step = "Done"; job.Status = "done"; }
            }
            catch (Exception e)
            {
                if (job.Cancel.IsCancellationRequested) { job.Status = "cancelled"; continue; }
                if (e is not AppError) log.LogError(e, "{Kind} failed", job.Kind);
                else log.LogWarning("{Kind}: {Message}", job.Kind, e.Message);
                job.Error = e.Message.Split('\n')[0];
                job.Status = "failed";
            }
        }
    }
}
