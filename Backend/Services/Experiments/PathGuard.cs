namespace Backend.Services.Experiments;

/// <summary>
/// Resolve-under-root checks for user-supplied paths (design "Experiments", Req. 24.4, 24.13).
///
/// A relative path is accepted only if, after resolving <c>.</c> and <c>..</c> segments, it names
/// an entry strictly inside the root. Rejected outright: empty/whitespace, rooted or fully
/// qualified paths (<c>/x</c>, <c>\x</c>, <c>C:\x</c>, <c>C:x</c>, UNC <c>\\server\share</c>,
/// device paths <c>\\?\</c>), any <c>:</c> (drive letters, NTFS alternate data streams), NUL and
/// other invalid path characters, and segments ending in '.' or ' ' (which Windows silently
/// strips, so they would name a different entry than the one checked). Symbolic links met while
/// walking from the root to the target are resolved and must stay inside the root.
/// </summary>
public static class PathGuard
{
    private static readonly char[] Separators = ['/', '\\'];

    private static readonly char[] InvalidChars =
        Path.GetInvalidPathChars().Concat(['*', '?', '"', '<', '>', '|', ':']).Distinct().ToArray();

    /// <summary>Path comparison used for containment: case-insensitive on Windows and macOS.</summary>
    public static StringComparison Comparison { get; } =
        OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

    /// <summary>
    /// Resolve <paramref name="relative"/> under <paramref name="root"/> and require an existing
    /// regular file there. Returns the full path only if every check passes.
    /// </summary>
    public static bool TryResolveExistingFile(string root, string? relative, out string fullPath, out string error)
    {
        if (!TryResolveUnderRoot(root, relative, out fullPath, out error))
            return false;
        if (!File.Exists(fullPath))
        {
            fullPath = "";
            error = "does not exist";
            return false;
        }
        return true;
    }

    /// <summary>Like <see cref="TryResolveExistingFile"/> but requires an existing directory.</summary>
    public static bool TryResolveExistingDirectory(string root, string? relative, out string fullPath, out string error)
    {
        if (!TryResolveUnderRoot(root, relative, out fullPath, out error))
            return false;
        if (!Directory.Exists(fullPath))
        {
            fullPath = "";
            error = "does not exist";
            return false;
        }
        return true;
    }

    /// <summary>
    /// Resolve <paramref name="relative"/> under <paramref name="root"/> without requiring the
    /// target to exist. The resolved path is never equal to the root itself.
    /// </summary>
    public static bool TryResolveUnderRoot(string root, string? relative, out string fullPath, out string error)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(root))
        {
            error = "root directory is not configured";
            return false;
        }
        if (string.IsNullOrWhiteSpace(relative))
        {
            error = "must be a non-empty path";
            return false;
        }
        if (relative.IndexOfAny(InvalidChars) >= 0 || relative.Any(char.IsControl))
        {
            error = "must be a relative path without drive letters, stream names, or invalid characters";
            return false;
        }
        if (Path.IsPathRooted(relative) || Path.IsPathFullyQualified(relative) || relative[0] is '/' or '\\')
        {
            error = "must be a relative path inside the configured directory";
            return false;
        }
        foreach (var segment in relative.Split(Separators))
        {
            if (segment is "." or ".." or "")
                continue;
            if (segment.EndsWith('.') || segment.EndsWith(' ') || segment.StartsWith(' '))
            {
                error = "must not contain path segments that start with a space or end with '.' or a space";
                return false;
            }
        }

        string rootFull;
        string combined;
        try
        {
            rootFull = NormalizeRoot(root);
            combined = Path.GetFullPath(Path.Combine(rootFull, relative));
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            error = "is not a valid path";
            return false;
        }

        if (!IsStrictlyUnder(rootFull, combined))
        {
            error = "resolves outside the configured directory";
            return false;
        }
        if (EscapesThroughLink(rootFull, combined))
        {
            error = "resolves outside the configured directory through a link";
            return false;
        }

        fullPath = combined;
        error = "";
        return true;
    }

    /// <summary>True if <paramref name="candidate"/> (full path) is strictly inside <paramref name="root"/>.</summary>
    public static bool IsStrictlyUnder(string root, string candidate)
    {
        var rootFull = NormalizeRoot(root);
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
        // A filesystem root such as "C:\" already ends with a separator.
        var prefix = Path.EndsInDirectorySeparator(rootFull) ? rootFull : rootFull + Path.DirectorySeparatorChar;
        return full.StartsWith(prefix, Comparison) && full.Length > prefix.Length;
    }

    private static bool IsUnderOrEqual(string root, string candidate)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
        return string.Equals(full, root, Comparison) || IsStrictlyUnder(root, full);
    }

    private static string NormalizeRoot(string root) =>
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));

    /// <summary>
    /// Walk each existing entry from the root to <paramref name="target"/>; if any is a link whose
    /// final target is outside the root (by its configured path or its real path), report an escape.
    /// </summary>
    private static bool EscapesThroughLink(string rootFull, string target)
    {
        var allowedRoots = new List<string> { rootFull };
        var realRoot = RealPath(rootFull);
        if (realRoot is not null && !string.Equals(realRoot, rootFull, Comparison))
            allowedRoots.Add(realRoot);

        var current = rootFull;
        var relative = Path.GetRelativePath(rootFull, target);
        foreach (var segment in relative.Split(Separators, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (!info.Exists && info.LinkTarget is null)
                return false; // nothing further exists on disk to escape through
            if (info.LinkTarget is null)
                continue;

            FileSystemInfo? final;
            try
            {
                final = info.ResolveLinkTarget(returnFinalTarget: true);
            }
            catch (IOException)
            {
                return true; // unresolvable link (e.g. cycle): treat as unsafe
            }
            if (final is null)
                return true;
            if (!allowedRoots.Any(r => IsUnderOrEqual(r, final.FullName)))
                return true;
        }
        return false;
    }

    private static string? RealPath(string dir)
    {
        try
        {
            var info = new DirectoryInfo(dir);
            if (info.LinkTarget is null)
                return dir;
            var final = info.ResolveLinkTarget(returnFinalTarget: true);
            return final is null ? null : Path.TrimEndingDirectorySeparator(Path.GetFullPath(final.FullName));
        }
        catch (IOException)
        {
            return null;
        }
    }
}
