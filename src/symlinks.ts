/**
 * Symlink operations for tree and normal symlinks
 */

import { dirname, globToRegExp, join, relative } from "@std/path";
import { ensureDir, expandGlob } from "@std/fs";
import { gray } from "@std/fmt/colors";
import type {
  ExcludeConfig,
  ExecutionContext,
  SymlinkResult,
  SymlinksConfig,
  UserConfig,
} from "./types.ts";

/**
 * Default patterns to exclude from recursive glob matching.
 * These are commonly large directories that should not be traversed.
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.vercel/**",
  "**/.conductor/**",
];

/**
 * Compute the effective exclusion patterns based on configuration.
 * Merges defaults, user-level excludes, and project-level excludes.
 * If replaceDefaults is true on project config, only uses project patterns.
 */
function getEffectiveExclusions(
  userConfig: UserConfig,
  exclude?: ExcludeConfig,
): string[] {
  const userExcludes = userConfig.excludes ?? [];

  if (!exclude) {
    return [...DEFAULT_EXCLUDE_PATTERNS, ...userExcludes];
  }
  if (exclude.replaceDefaults) {
    return exclude.patterns;
  }
  return [...DEFAULT_EXCLUDE_PATTERNS, ...userExcludes, ...exclude.patterns];
}

/**
 * Pre-compile glob patterns to RegExp for efficient repeated matching.
 * This avoids recompiling patterns for every path check.
 */
function compileExcludePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) =>
    globToRegExp(pattern, { extended: true, globstar: true })
  );
}

/**
 * Check if a relative path should be excluded based on pre-compiled patterns.
 */
function shouldExclude(
  relativePath: string,
  compiledPatterns: RegExp[],
): boolean {
  return compiledPatterns.some((regex) => regex.test(relativePath));
}

/**
 * Information about a filesystem path, gathered in a single operation.
 */
interface PathInfo {
  exists: boolean;
  isSymlink: boolean;
  isDirectory: boolean;
  linkTarget: string | null;
}

/**
 * Get comprehensive path information in minimal stat calls.
 * Returns all info needed for symlink decisions in one lookup.
 */
async function getPathInfo(path: string): Promise<PathInfo> {
  try {
    const lstatResult = await Deno.lstat(path);
    const isSymlink = lstatResult.isSymlink;

    // For symlinks, we need to read the link target
    // For real directories, use lstat result; for symlinks, check what they point to
    let isDirectory = lstatResult.isDirectory;
    let linkTarget: string | null = null;

    if (isSymlink) {
      linkTarget = await Deno.readLink(path);
      // Check if symlink points to a directory
      try {
        const statResult = await Deno.stat(path);
        isDirectory = statResult.isDirectory;
      } catch {
        // Broken symlink - target doesn't exist
        isDirectory = false;
      }
    }

    return { exists: true, isSymlink, isDirectory, linkTarget };
  } catch {
    return {
      exists: false,
      isSymlink: false,
      isDirectory: false,
      linkTarget: null,
    };
  }
}

/**
 * Execute async functions with a concurrency limit.
 * Processes items in parallel up to the limit, collecting all results.
 */
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const result = await fn(items[currentIndex]);
      results[currentIndex] = result;
    }
  }

  // Create workers up to the limit
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Filter out paths that are children of other paths in the list.
 * When a directory and its contents both match a glob, keep only the directory.
 */
function filterParentChildConflicts(paths: string[]): string[] {
  if (paths.length <= 1) return paths;

  // Sort by length (shortest first) so directories come before their contents
  const sorted = [...paths].sort((a, b) => a.length - b.length);
  const result: string[] = [];
  const parentPaths = new Set<string>();

  for (const path of sorted) {
    // Check if any existing path is a parent of this one
    let hasParent = false;
    for (const parent of parentPaths) {
      if (path.startsWith(parent + "/")) {
        hasParent = true;
        break;
      }
    }

    if (!hasParent) {
      result.push(path);
      parentPaths.add(path);
    }
  }

  return result;
}

/**
 * Create a symlink from source to target using optimistic approach.
 * Tries to create symlink first, only stats on failure (saves syscalls in common case).
 *
 * @param sourceExists - If true, skip checking if source exists (caller verified via readdir)
 * @param targetInfo - Pre-fetched target info to avoid redundant stat calls
 */
async function createSymlink(
  source: string,
  target: string,
  dryRun: boolean,
  sourceExists?: boolean,
  targetInfo?: PathInfo,
): Promise<SymlinkResult> {
  const result: SymlinkResult = {
    source,
    target,
    success: true,
    action: "created",
  };

  // Only check source if caller hasn't verified it
  if (!sourceExists) {
    const sourceInfo = await getPathInfo(source);
    if (!sourceInfo.exists) {
      return {
        ...result,
        success: false,
        action: "error",
        reason: `Source does not exist: ${source}`,
      };
    }
  }

  // If targetInfo provided, we already know target exists - handle skip cases
  if (targetInfo?.exists) {
    if (targetInfo.isSymlink) {
      if (targetInfo.linkTarget === source) {
        return {
          ...result,
          action: "skipped",
          reason: "Symlink already exists and points to correct source",
        };
      }
      return {
        ...result,
        action: "skipped",
        reason:
          `Existing symlink points to different target: ${targetInfo.linkTarget}`,
      };
    }
    return {
      ...result,
      action: "skipped",
      reason: "Local file/directory exists (preserving local override)",
    };
  }

  if (dryRun) {
    // In dry-run, we need to check if target exists to report accurately
    if (!targetInfo) {
      const info = await getPathInfo(target);
      if (info.exists) {
        if (info.isSymlink && info.linkTarget === source) {
          return {
            ...result,
            action: "skipped",
            reason: "Symlink already exists and points to correct source",
          };
        }
        if (info.isSymlink) {
          return {
            ...result,
            action: "skipped",
            reason:
              `Existing symlink points to different target: ${info.linkTarget}`,
          };
        }
        return {
          ...result,
          action: "skipped",
          reason: "Local file/directory exists (preserving local override)",
        };
      }
    }
    console.log(`  ${gray("[dry-run]")} Would create: ${target}`);
    return result;
  }

  // Optimistic approach: try to create symlink first
  // This saves a stat call in the common case where target doesn't exist
  try {
    await Deno.symlink(source, target);
    return result;
  } catch (error) {
    // If symlink failed, check why
    if (error instanceof Deno.errors.AlreadyExists) {
      // Target exists - stat it to determine skip reason
      const info = await getPathInfo(target);
      if (info.isSymlink) {
        if (info.linkTarget === source) {
          return {
            ...result,
            action: "skipped",
            reason: "Symlink already exists and points to correct source",
          };
        }
        return {
          ...result,
          action: "skipped",
          reason:
            `Existing symlink points to different target: ${info.linkTarget}`,
        };
      }
      return {
        ...result,
        action: "skipped",
        reason: "Local file/directory exists (preserving local override)",
      };
    }

    if (error instanceof Deno.errors.NotFound) {
      // Parent directory doesn't exist - create it and retry
      try {
        await ensureDir(dirname(target));
        await Deno.symlink(source, target);
        return result;
      } catch (retryError) {
        return {
          ...result,
          success: false,
          action: "error",
          reason: `Failed to create symlink: ${retryError}`,
        };
      }
    }

    return {
      ...result,
      success: false,
      action: "error",
      reason: `Failed to create symlink: ${error}`,
    };
  }
}

/** Concurrency limit for parallel file operations */
const PARALLEL_LIMIT = 100;

/**
 * Process tree symlinks - recursively link directory contents
 * preserving any local overrides in the target.
 *
 * This creates symlinks at the leaf level (files) rather than
 * at the directory level, allowing local files to override.
 *
 * Uses pre-compiled exclusion patterns and parallel processing for efficiency.
 * Minimizes stat calls by trusting readdir's file type information.
 */
async function processTreeSymlink(
  rootPath: string,
  worktreePath: string,
  relativePath: string,
  dryRun: boolean,
  verbose: boolean,
  compiledExclude: RegExp[],
): Promise<SymlinkResult[]> {
  const sourcePath = join(rootPath, relativePath);

  // Try to read directory - if it fails, source doesn't exist or isn't a directory
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(sourcePath)) {
      entries.push(entry);
    }
  } catch (error) {
    // Check if source exists but is a file (not a directory)
    if (error instanceof Deno.errors.NotADirectory) {
      const targetPath = join(worktreePath, relativePath);
      const result = await createSymlink(sourcePath, targetPath, dryRun, true);
      return [result];
    }
    // Source doesn't exist
    if (verbose) {
      console.log(`  Skipping ${relativePath}: source doesn't exist`);
    }
    return [];
  }

  // Process an entry and return its results
  // Readdir already gives us file type - no need to stat source!
  async function processEntry(
    entry: Deno.DirEntry,
  ): Promise<SymlinkResult[]> {
    const childRelative = join(relativePath, entry.name);
    const childSource = join(rootPath, childRelative);
    const childTarget = join(worktreePath, childRelative);

    // Check if this entry should be excluded (fast regex check)
    if (shouldExclude(childRelative, compiledExclude)) {
      if (verbose) {
        console.log(`  Skipping ${childRelative}: matches exclusion pattern`);
      }
      return [];
    }

    // For FILES: use optimistic approach - don't stat, just try to create symlink
    // This saves a syscall for the common case where target doesn't exist
    if (!entry.isDirectory) {
      return [await createSymlink(childSource, childTarget, dryRun, true)];
    }

    // For DIRECTORIES: we need to stat target to decide how to handle
    const targetInfo = await getPathInfo(childTarget);

    // If target is a real directory (not symlink), recurse into it
    if (targetInfo.exists && !targetInfo.isSymlink) {
      return processTreeSymlink(
        rootPath,
        worktreePath,
        childRelative,
        dryRun,
        verbose,
        compiledExclude,
      );
    }

    // If target is a symlink to the source directory, skip
    if (targetInfo.isSymlink && targetInfo.linkTarget === childSource) {
      return [
        {
          source: childSource,
          target: childTarget,
          success: true,
          action: "skipped",
          reason: "Directory symlink already exists",
        },
      ];
    }

    // Target doesn't exist or is a symlink to somewhere else - recurse
    return processTreeSymlink(
      rootPath,
      worktreePath,
      childRelative,
      dryRun,
      verbose,
      compiledExclude,
    );
  }

  // Process all entries in parallel - files and dirs together
  // This improves throughput by not waiting for all files before starting dirs
  const resultArrays = await parallelLimit(
    entries,
    PARALLEL_LIMIT,
    processEntry,
  );

  return resultArrays.flat();
}

/**
 * Collect matches for a normal (glob-based) symlink pattern.
 * Returns source paths without creating symlinks.
 */
async function collectNormalSymlinkMatches(
  rootPath: string,
  pattern: string,
  verbose: boolean,
  exclude: string[],
): Promise<string[]> {
  // Only apply exclusions for recursive glob patterns to avoid
  // unnecessarily filtering specific path patterns
  const shouldExclude = pattern.includes("**");

  // Expand the glob pattern from the root path
  const globOptions = {
    root: rootPath,
    includeDirs: true,
    followSymlinks: false,
    exclude: shouldExclude ? exclude : undefined,
  };

  if (verbose && shouldExclude) {
    console.log(`  Applying ${exclude.length} exclusion patterns`);
  }

  const matches: string[] = [];
  for await (const entry of expandGlob(pattern, globOptions)) {
    matches.push(entry.path);
  }

  if (verbose && matches.length === 0) {
    console.log(`  No matches found for pattern: ${pattern}`);
  }

  return matches;
}

/**
 * Process all symlinks from configuration.
 * Uses pre-compiled patterns and parallel processing for efficiency.
 */
export async function processSymlinks(
  ctx: ExecutionContext,
): Promise<SymlinkResult[]> {
  const { rootPath, worktreePath, config, userConfig, options } = ctx;
  const results: SymlinkResult[] = [];

  if (!config.symlinks) {
    return results;
  }

  const symlinks: SymlinksConfig = config.symlinks;

  // Compute effective exclusions once for all symlinks
  const excludePatterns = getEffectiveExclusions(userConfig, symlinks.exclude);

  // Pre-compile exclusion patterns for tree symlink processing
  const compiledExclude = compileExcludePatterns(excludePatterns);

  // Process tree symlinks
  if (symlinks.tree) {
    for (const tree of symlinks.tree) {
      if (options.verbose) {
        console.log(`Processing tree symlink: ${tree.path}`);
      }
      const treeResults = await processTreeSymlink(
        rootPath,
        worktreePath,
        tree.path,
        options.dryRun,
        options.verbose,
        compiledExclude,
      );
      results.push(...treeResults);
    }
  }

  // Process normal symlinks - collect all matches first, then filter and create
  if (symlinks.normal) {
    // Collect all matches from all patterns in parallel
    if (options.verbose) {
      for (const normal of symlinks.normal) {
        console.log(`Processing normal symlink pattern: ${normal.pattern}`);
      }
    }

    const matchArrays = await Promise.all(
      symlinks.normal.map((normal) =>
        collectNormalSymlinkMatches(
          rootPath,
          normal.pattern,
          options.verbose,
          excludePatterns,
        )
      ),
    );
    const allMatches = matchArrays.flat();

    // Filter out child paths when parent exists across all patterns
    const filteredMatches = filterParentChildConflicts(allMatches);

    if (options.verbose && filteredMatches.length < allMatches.length) {
      console.log(
        `Filtered ${
          allMatches.length - filteredMatches.length
        } child paths (parent takes precedence)`,
      );
    }

    // Create symlinks for filtered matches in parallel
    const symlinkResults = await parallelLimit(
      filteredMatches,
      PARALLEL_LIMIT,
      (sourcePath) => {
        const relativePath = relative(rootPath, sourcePath);
        const targetPath = join(worktreePath, relativePath);
        return createSymlink(sourcePath, targetPath, options.dryRun);
      },
    );
    results.push(...symlinkResults);
  }

  return results;
}

/**
 * Print symlink results summary
 */
export function printSymlinkSummary(
  results: SymlinkResult[],
  verbose: boolean,
  dryRun: boolean,
): void {
  const errors = results.filter((r) => r.action === "error");

  // In dry-run mode, only print errors (dry-run messages already printed in createSymlink)
  if (dryRun) {
    if (errors.length > 0) {
      console.log("  Errors:");
      for (const error of errors) {
        console.log(`    ${error.target}: ${error.reason}`);
      }
    }
    return;
  }

  const created = results.filter((r) => r.action === "created");
  const skipped = results.filter((r) => r.action === "skipped");

  if (verbose) {
    for (const result of results) {
      const icon = result.action === "created"
        ? "✓"
        : result.action === "skipped"
        ? "○"
        : "✗";
      const suffix = result.reason ? ` (${result.reason})` : "";
      console.log(`  ${icon} ${relative(Deno.cwd(), result.target)}${suffix}`);
    }
  }

  console.log(
    `  Created: ${created.length}, Skipped: ${skipped.length}, Errors: ${errors.length}`,
  );

  if (errors.length > 0 && !verbose) {
    console.log("  Errors:");
    for (const error of errors) {
      console.log(`    ${error.target}: ${error.reason}`);
    }
  }
}
