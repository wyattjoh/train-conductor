#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * train-conductor - Worktree setup tool
 *
 * A CLI tool for setting up git worktrees with symlinks and scripts
 * configured via .conductor.local.toml
 */

import { bold, cyan, gray, green, red, yellow } from "@std/fmt/colors";
import { parseArgs } from "@std/cli/parse-args";
import { fromFileUrl, join } from "@std/path";
import type { CliOptions, ExecutionContext } from "./types.ts";
import { loadConfig, SYMLINKS_OPERATION } from "./config.ts";
import {
  getCurrentWorktreeRoot,
  getMainWorktreePath,
  getNonMainWorktrees,
  isInWorktree,
} from "./worktree.ts";
import { printSymlinkSummary, processSymlinks } from "./symlinks.ts";
import { printScriptSummary, runScripts } from "./scripts.ts";
import { showInteractiveMenu } from "./interactive.ts";

/** Read version from deno.json to maintain single source of truth */
async function getVersion(): Promise<string> {
  try {
    const moduleDir = fromFileUrl(new URL(".", import.meta.url));
    const denoJsonPath = join(moduleDir, "..", "deno.json");
    const content = await Deno.readTextFile(denoJsonPath);
    const json = JSON.parse(content) as { version?: string };
    return json.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Generate help text with version */
function getHelpText(version: string): string {
  return `
🚂 ${bold("train-conductor")} - Worktree setup tool v${version}

${bold("USAGE:")}
  train-conductor [OPTIONS]

${bold("OPTIONS:")}
  -h, --help              Show this help message
  -i, --interactive       Select operations via interactive menu
  -o, --only <list>       Run only specific operations (comma-separated)
                          Values: symlinks, <script-name>, all
  -w, --workspaces        Run across all git worktrees (except main)
  -c, --config <path>     Override config file path
  -n, --dry-run           Show what would be done without making changes
  -v, --verbose           Verbose output
      --version           Show version number

${bold("EXAMPLES:")}
  train-conductor                       # Run all: symlinks + all scripts
  train-conductor -o symlinks           # Symlinks only
  train-conductor -o symlinks,install   # Symlinks + install script
  train-conductor -w                    # Run in all worktrees
  train-conductor -i                    # Interactive mode
  train-conductor -n                    # Dry run

${bold("CONFIGURATION:")}
  Create a .conductor.local.toml file in your repository root.
  See documentation for config file format.
`;
}

/**
 * Parse command line arguments
 */
function parseCliArgs(args: string[]): CliOptions {
  const parsed = parseArgs(args, {
    boolean: [
      "help",
      "interactive",
      "workspaces",
      "dry-run",
      "verbose",
      "version",
    ],
    string: ["only", "config"],
    alias: {
      h: "help",
      i: "interactive",
      o: "only",
      w: "workspaces",
      c: "config",
      n: "dry-run",
      v: "verbose",
    },
  });

  return {
    help: parsed.help ?? false,
    interactive: parsed.interactive ?? false,
    only: parsed.only
      ? parsed.only.split(",").map((s: string) => s.trim())
      : undefined,
    workspaces: parsed.workspaces ?? false,
    configPath: parsed.config,
    dryRun: parsed["dry-run"] ?? false,
    verbose: parsed.verbose ?? false,
  };
}

/**
 * Run setup in a single worktree
 */
async function runSetupInWorktree(
  rootPath: string,
  worktreePath: string,
  options: CliOptions,
  operations?: string[],
): Promise<boolean> {
  // Load config from root path
  const config = await loadConfig(options.configPath, rootPath);

  // Create execution context
  const ctx: ExecutionContext = {
    rootPath,
    worktreePath,
    config,
    options,
  };

  // Determine which operations to run
  let selectedOps: string[];

  if (operations) {
    // Operations explicitly provided
    selectedOps = operations;
  } else if (options.interactive) {
    // Interactive mode
    const selected = await showInteractiveMenu(config);
    if (selected === null) {
      console.log(yellow("Cancelled by user"));
      return false;
    }
    selectedOps = selected;
  } else if (options.only) {
    // --only flag
    if (options.only.includes("all")) {
      selectedOps = [SYMLINKS_OPERATION];
      if (config.scripts) {
        selectedOps.push(...config.scripts.map((s) => s.name));
      }
    } else {
      selectedOps = options.only;
    }
  } else {
    // Default: run everything
    selectedOps = [SYMLINKS_OPERATION];
    if (config.scripts) {
      selectedOps.push(...config.scripts.map((s) => s.name));
    }
  }

  if (selectedOps.length === 0) {
    console.log(yellow("No operations selected"));
    return true;
  }

  // Track success
  let success = true;

  // Run symlinks if selected
  if (selectedOps.includes(SYMLINKS_OPERATION)) {
    console.log(`\n${bold("→")} Creating symlinks`);
    const symlinkResults = await processSymlinks(ctx);
    printSymlinkSummary(symlinkResults, options.verbose);

    const hasErrors = symlinkResults.some((r) => r.action === "error");
    if (hasErrors) {
      success = false;
    }
  }

  // Run scripts
  const scriptNames = selectedOps.filter((op) => op !== SYMLINKS_OPERATION);
  if (scriptNames.length > 0) {
    const scriptResults = await runScripts(ctx, scriptNames);
    printScriptSummary(scriptResults);

    const hasFailures = scriptResults.some((r) => !r.success);
    if (hasFailures) {
      success = false;
    }
  }

  return success;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const options = parseCliArgs(Deno.args);
  const version = await getVersion();

  // Handle --help
  if (options.help) {
    console.log(getHelpText(version));
    Deno.exit(0);
  }

  // Handle --version (check for explicit version flag in args)
  if (Deno.args.includes("--version")) {
    console.log(`🚂 train-conductor v${version}`);
    Deno.exit(0);
  }

  // Check if we're in a git worktree
  if (!(await isInWorktree())) {
    console.error(red("Error: ") + "Not in a git repository");
    Deno.exit(1);
  }

  // Get root path (main worktree)
  const rootPath = await getMainWorktreePath();
  const currentPath = await getCurrentWorktreeRoot();

  if (options.verbose) {
    console.log(gray(`Root: ${rootPath}`));
    console.log(gray(`Current: ${currentPath}`));
  }

  // Check if we're in the main worktree
  const isMainWorktree = rootPath === currentPath;

  if (isMainWorktree && !options.workspaces) {
    console.log(
      yellow("Note: ") +
        "You're in the main worktree. Use --workspaces to run in all worktrees.",
    );
    console.log(gray("Nothing to do in main worktree."));
    Deno.exit(0);
  }

  if (options.workspaces) {
    // Run in all non-main worktrees
    const worktrees = await getNonMainWorktrees();

    if (worktrees.length === 0) {
      console.log(yellow("No worktrees found (besides main)"));
      Deno.exit(0);
    }

    console.log(
      `🚂 ${bold(`Running setup in ${worktrees.length} worktree(s):`)}`,
    );

    // For interactive mode, get operations once
    let operations: string[] | undefined;
    if (options.interactive) {
      const config = await loadConfig(options.configPath, rootPath);
      const selected = await showInteractiveMenu(config);
      if (selected === null) {
        console.log(yellow("Cancelled by user"));
        Deno.exit(1);
      }
      operations = selected;
    }

    let allSuccess = true;
    for (const worktree of worktrees) {
      const branchInfo = worktree.branch ? ` (${cyan(worktree.branch)})` : "";
      console.log(`\n${bold("━".repeat(60))}`);
      console.log(`${bold("Worktree:")} ${worktree.path}${branchInfo}`);
      console.log(bold("━".repeat(60)));

      try {
        const success = await runSetupInWorktree(
          rootPath,
          worktree.path,
          options,
          operations,
        );
        if (!success) {
          allSuccess = false;
        }
      } catch (error) {
        console.error(red(`Error in ${worktree.path}: ${error}`));
        allSuccess = false;
      }
    }

    if (allSuccess) {
      console.log(
        `\n${green("✓")} ${bold("All worktrees set up successfully")}`,
      );
    } else {
      console.log(`\n${red("✗")} ${bold("Some worktrees had errors")}`);
      Deno.exit(1);
    }
  } else {
    // Run in current worktree only
    console.log(`🚂 ${bold(`Setting up worktree: ${currentPath}`)}`);

    if (options.dryRun) {
      console.log(gray("[dry-run mode - no changes will be made]"));
    }

    try {
      const success = await runSetupInWorktree(rootPath, currentPath, options);
      if (success) {
        console.log(`\n${green("✓")} ${bold("Setup complete")}`);
      } else {
        console.log(`\n${red("✗")} ${bold("Setup completed with errors")}`);
        Deno.exit(1);
      }
    } catch (error) {
      console.error(red(`Error: ${error}`));
      Deno.exit(1);
    }
  }
}

// Run main
main();
