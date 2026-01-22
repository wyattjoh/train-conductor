#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * conduit - Worktree setup tool
 *
 * A CLI tool for setting up git worktrees with symlinks and scripts
 * configured via .conductor.local.toml
 */

import { bold, cyan, gray, green, red, yellow } from "@std/fmt/colors";
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import type { CliOptions, Config, ExecutionContext } from "./types.ts";
import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG_TEMPLATE,
  loadConfig,
  loadConfigStandalone,
  loadUserConfig,
  SYMLINKS_OPERATION,
} from "./config.ts";
import {
  getCurrentWorktreeRoot,
  getMainWorktreePath,
  getNonMainWorktrees,
  isInWorktree,
} from "./worktree.ts";
import { printSymlinkSummary, processSymlinks } from "./symlinks.ts";
import { printScriptSummary, runScripts } from "./scripts.ts";
import { showInteractiveMenu } from "./interactive.ts";
import denoConfig from "../deno.json" with { type: "json" };

/** Version from deno.json, bundled at compile time */
const VERSION = denoConfig.version;

/** Generate help text with version */
function getHelpText(version: string): string {
  return `
🔗 ${bold("conduit")} - Worktree setup tool v${version}

${bold("USAGE:")}
  conduit <command> [OPTIONS]

${bold("COMMANDS:")}
  setup       Run worktree setup (symlinks + scripts)
  validate    Validate configuration file without running setup
  init        Create a default .conductor.local.toml template

${bold("OPTIONS:")}
  -h, --help              Show this help message
  -i, --interactive       Select operations via interactive menu (setup only)
  -o, --only <list>       Run only specific operations (setup only)
                          Values: symlinks, <script-name>, all
  -w, --worktrees         Run across all git worktrees (setup only)
  -c, --config <path>     Override config file path
  -n, --dry-run           Show what would be done without changes (setup only)
  -v, --verbose           Verbose output
      --version           Show version number

${bold("EXAMPLES:")}
  conduit setup                 # Run all: symlinks + all scripts
  conduit setup -o symlinks     # Symlinks only
  conduit setup -w              # Run in all worktrees
  conduit setup -i              # Interactive mode
  conduit setup -n              # Dry run
  conduit validate              # Validate config file
  conduit init                  # Create default config

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
      "worktrees",
      "dry-run",
      "verbose",
      "version",
    ],
    string: ["only", "config"],
    alias: {
      h: "help",
      i: "interactive",
      o: "only",
      w: "worktrees",
      c: "config",
      n: "dry-run",
      v: "verbose",
    },
  });

  // Extract subcommand from positional args
  const subcommand = typeof parsed._[0] === "string" ? parsed._[0] : undefined;

  return {
    help: parsed.help ?? false,
    interactive: parsed.interactive ?? false,
    only: parsed.only
      ? parsed.only.split(",").map((s: string) => s.trim())
      : undefined,
    worktrees: parsed.worktrees ?? false,
    configPath: parsed.config,
    dryRun: parsed["dry-run"] ?? false,
    verbose: parsed.verbose ?? false,
    subcommand,
  };
}

/**
 * Print a summary of the loaded configuration
 */
function printConfigSummary(configPath: string, config: Config): void {
  const treeCount = config.symlinks?.tree?.length ?? 0;
  const normalCount = config.symlinks?.normal?.length ?? 0;
  const scriptCount = config.scripts?.length ?? 0;
  const scriptNames = config.scripts?.map((s) => s.name).join(", ") ?? "";

  console.log(green("Configuration valid: ") + configPath);
  console.log(`  Symlinks: ${treeCount} tree, ${normalCount} normal`);
  if (scriptCount > 0) {
    console.log(`  Scripts: ${scriptCount} defined (${scriptNames})`);
  } else {
    console.log("  Scripts: none defined");
  }
}

/**
 * Run the validate subcommand
 */
async function runValidateCommand(options: CliOptions): Promise<void> {
  const configPath = options.configPath ?? join(Deno.cwd(), CONFIG_FILE_NAME);

  try {
    const config = await loadConfigStandalone(configPath);
    printConfigSummary(configPath, config);
    Deno.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(red("Error: ") + message);
    Deno.exit(1);
  }
}

/**
 * Run the init subcommand
 */
async function runInitCommand(options: CliOptions): Promise<void> {
  const configPath = options.configPath ?? join(Deno.cwd(), CONFIG_FILE_NAME);

  // Check if file already exists
  try {
    await Deno.stat(configPath);
    console.error(
      red("Error: ") + `Configuration file already exists: ${configPath}`,
    );
    Deno.exit(1);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  // Write the template
  await Deno.writeTextFile(configPath, DEFAULT_CONFIG_TEMPLATE);
  console.log(green("Created: ") + configPath);
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
  // Load config from root path and user config
  const config = await loadConfig(options.configPath, rootPath);
  const userConfig = await loadUserConfig();

  // Create execution context
  const ctx: ExecutionContext = {
    rootPath,
    worktreePath,
    config,
    userConfig,
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
    printSymlinkSummary(symlinkResults, options.verbose, options.dryRun);

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

  // Handle --help
  if (options.help) {
    console.log(getHelpText(VERSION));
    Deno.exit(0);
  }

  // Handle --version (check for explicit version flag in args)
  if (Deno.args.includes("--version")) {
    console.log(`🔗 conduit v${VERSION}`);
    Deno.exit(0);
  }

  // Handle subcommands that don't require worktree context
  if (options.subcommand === "validate") {
    await runValidateCommand(options);
    return;
  }

  if (options.subcommand === "init") {
    await runInitCommand(options);
    return;
  }

  // Require a subcommand
  if (options.subcommand !== "setup") {
    if (options.subcommand) {
      console.error(red("Error: ") + `Unknown command: ${options.subcommand}`);
    } else {
      console.error(red("Error: ") + "No command specified");
    }
    console.error(gray("Run 'conduit --help' for usage information."));
    Deno.exit(1);
  }

  // Check if we're in a git worktree (required for setup)
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

  if (isMainWorktree && !options.worktrees) {
    console.log(
      yellow("Note: ") +
        "You're in the main worktree. Use --worktrees to run in all worktrees.",
    );
    console.log(gray("Nothing to do in main worktree."));
    Deno.exit(0);
  }

  if (options.worktrees) {
    // Run in all non-main worktrees
    const worktrees = await getNonMainWorktrees();

    if (worktrees.length === 0) {
      console.log(yellow("No worktrees found (besides main)"));
      Deno.exit(0);
    }

    console.log(
      `🔗 ${bold(`Running setup in ${worktrees.length} worktree(s):`)}`,
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
    console.log(`🔗 ${bold(`Setting up worktree: ${currentPath}`)}`);

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
