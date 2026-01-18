/**
 * Symlink operations for tree and normal symlinks
 */

import { dirname, join, relative } from "@std/path";
import { ensureDir, expandGlob } from "@std/fs";
import type {
  ExecutionContext,
  SymlinkResult,
  SymlinksConfig,
} from "./types.ts";

/**
 * Check if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a symlink
 */
async function isSymlink(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isSymlink;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Get the target of a symlink
 */
async function readSymlink(path: string): Promise<string | null> {
  try {
    return await Deno.readLink(path);
  } catch {
    return null;
  }
}

/**
 * Create a symlink from source to target
 */
async function createSymlink(
  source: string,
  target: string,
  dryRun: boolean,
): Promise<SymlinkResult> {
  const result: SymlinkResult = {
    source,
    target,
    success: true,
    action: "created",
  };

  // Check if source exists
  if (!(await pathExists(source))) {
    return {
      ...result,
      success: false,
      action: "error",
      reason: `Source does not exist: ${source}`,
    };
  }

  // Check if target already exists
  if (await pathExists(target)) {
    // If it's already a symlink pointing to the same source, skip
    if (await isSymlink(target)) {
      const currentTarget = await readSymlink(target);
      if (currentTarget === source) {
        return {
          ...result,
          action: "skipped",
          reason: "Symlink already exists and points to correct source",
        };
      }
      // Different target - consider this an override that should be preserved
      return {
        ...result,
        action: "skipped",
        reason: `Existing symlink points to different target: ${currentTarget}`,
      };
    }
    // It's a real file/directory - preserve local override
    return {
      ...result,
      action: "skipped",
      reason: "Local file/directory exists (preserving local override)",
    };
  }

  if (dryRun) {
    return result;
  }

  // Ensure parent directory exists
  try {
    await ensureDir(dirname(target));
  } catch (error) {
    return {
      ...result,
      success: false,
      action: "error",
      reason: `Failed to create parent directory: ${error}`,
    };
  }

  // Create the symlink
  try {
    await Deno.symlink(source, target);
    return result;
  } catch (error) {
    return {
      ...result,
      success: false,
      action: "error",
      reason: `Failed to create symlink: ${error}`,
    };
  }
}

/**
 * Process tree symlinks - recursively link directory contents
 * preserving any local overrides in the target.
 *
 * This creates symlinks at the leaf level (files) rather than
 * at the directory level, allowing local files to override.
 */
async function processTreeSymlink(
  rootPath: string,
  worktreePath: string,
  relativePath: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<SymlinkResult[]> {
  const results: SymlinkResult[] = [];
  const sourcePath = join(rootPath, relativePath);
  const targetPath = join(worktreePath, relativePath);

  // If source doesn't exist, nothing to do
  if (!(await pathExists(sourcePath))) {
    if (verbose) {
      console.log(`  Skipping ${relativePath}: source doesn't exist`);
    }
    return results;
  }

  // If source is not a directory, create a direct symlink
  if (!(await isDirectory(sourcePath))) {
    const result = await createSymlink(sourcePath, targetPath, dryRun);
    results.push(result);
    return results;
  }

  // It's a directory - recurse into it
  for await (const entry of Deno.readDir(sourcePath)) {
    const childRelative = join(relativePath, entry.name);
    const childSource = join(rootPath, childRelative);
    const childTarget = join(worktreePath, childRelative);

    // If target already exists as a real file/directory, skip (preserve local)
    if ((await pathExists(childTarget)) && !(await isSymlink(childTarget))) {
      if (entry.isDirectory) {
        // Recurse into existing directory to link contents
        const childResults = await processTreeSymlink(
          rootPath,
          worktreePath,
          childRelative,
          dryRun,
          verbose,
        );
        results.push(...childResults);
      } else {
        // File exists locally, skip it
        results.push({
          source: childSource,
          target: childTarget,
          success: true,
          action: "skipped",
          reason: "Local file exists (preserving local override)",
        });
      }
      continue;
    }

    if (entry.isDirectory) {
      // Check if target is a symlink to the source directory
      if (await isSymlink(childTarget)) {
        const linkTarget = await readSymlink(childTarget);
        if (linkTarget === childSource) {
          results.push({
            source: childSource,
            target: childTarget,
            success: true,
            action: "skipped",
            reason: "Directory symlink already exists",
          });
          continue;
        }
      }

      // Recurse into the directory
      const childResults = await processTreeSymlink(
        rootPath,
        worktreePath,
        childRelative,
        dryRun,
        verbose,
      );
      results.push(...childResults);
    } else {
      // It's a file - create symlink
      const result = await createSymlink(childSource, childTarget, dryRun);
      results.push(result);
    }
  }

  return results;
}

/**
 * Process normal (glob-based) symlinks
 */
async function processNormalSymlink(
  rootPath: string,
  worktreePath: string,
  pattern: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<SymlinkResult[]> {
  const results: SymlinkResult[] = [];

  // Expand the glob pattern from the root path
  const globOptions = {
    root: rootPath,
    includeDirs: true,
    followSymlinks: false,
  };

  let matchCount = 0;
  for await (const entry of expandGlob(pattern, globOptions)) {
    matchCount++;
    const relativePath = relative(rootPath, entry.path);
    const targetPath = join(worktreePath, relativePath);

    const result = await createSymlink(entry.path, targetPath, dryRun);
    results.push(result);
  }

  if (verbose && matchCount === 0) {
    console.log(`  No matches found for pattern: ${pattern}`);
  }

  return results;
}

/**
 * Process all symlinks from configuration
 */
export async function processSymlinks(
  ctx: ExecutionContext,
): Promise<SymlinkResult[]> {
  const { rootPath, worktreePath, config, options } = ctx;
  const results: SymlinkResult[] = [];

  if (!config.symlinks) {
    return results;
  }

  const symlinks: SymlinksConfig = config.symlinks;

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
      );
      results.push(...treeResults);
    }
  }

  // Process normal symlinks
  if (symlinks.normal) {
    for (const normal of symlinks.normal) {
      if (options.verbose) {
        console.log(`Processing normal symlink pattern: ${normal.pattern}`);
      }
      const normalResults = await processNormalSymlink(
        rootPath,
        worktreePath,
        normal.pattern,
        options.dryRun,
        options.verbose,
      );
      results.push(...normalResults);
    }
  }

  return results;
}

/**
 * Print symlink results summary
 */
export function printSymlinkSummary(
  results: SymlinkResult[],
  verbose: boolean,
): void {
  const created = results.filter((r) => r.action === "created");
  const skipped = results.filter((r) => r.action === "skipped");
  const errors = results.filter((r) => r.action === "error");

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
