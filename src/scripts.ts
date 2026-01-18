/**
 * Script execution with streaming output
 */

import { bold, gray, green, red, yellow } from "@std/fmt/colors";
import type { ExecutionContext, ScriptConfig, ScriptResult } from "./types.ts";

/**
 * Execute a single script
 */
async function executeScript(
  script: ScriptConfig,
  worktreePath: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<ScriptResult> {
  const result: ScriptResult = {
    name: script.name,
    success: true,
    exitCode: 0,
    skipped: false,
  };

  if (dryRun) {
    console.log(`  ${gray("[dry-run]")} Would run: ${script.command}`);
    return result;
  }

  if (verbose) {
    console.log(`  ${gray("$")} ${script.command}`);
  }

  // Execute the command using bash -c to handle shell features
  const command = new Deno.Command("bash", {
    args: ["-c", script.command],
    cwd: worktreePath,
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      // Ensure colors are enabled for child processes
      FORCE_COLOR: "1",
      TERM: Deno.env.get("TERM") ?? "xterm-256color",
    },
  });

  const process = command.spawn();

  // Stream stdout with prefix
  const stdoutReader = process.stdout.getReader();
  const stderrReader = process.stderr.getReader();

  const streamWithPrefix = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    prefix: string,
  ) => {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() || verbose) {
          console.log(`${prefix}${line}`);
        }
      }
    }

    // Handle remaining buffer
    if (buffer.trim()) {
      console.log(`${prefix}${buffer}`);
    }
  };

  // Stream both stdout and stderr concurrently
  const streamPromises = [
    streamWithPrefix(stdoutReader, verbose ? gray("  │ ") : "  "),
    streamWithPrefix(stderrReader, verbose ? gray("  │ ") : "  "),
  ];

  // Wait for streams to finish and get exit status
  const [status] = await Promise.all([process.status, ...streamPromises]);

  result.exitCode = status.code;
  result.success = status.success;

  if (!status.success && script.optional) {
    result.success = true;
    result.reason =
      `Command failed with exit code ${status.code} (optional, continuing)`;
  } else if (!status.success) {
    result.reason = `Command failed with exit code ${status.code}`;
  }

  return result;
}

/**
 * Run a specific script by name
 */
export function runScript(
  ctx: ExecutionContext,
  scriptName: string,
): Promise<ScriptResult> {
  const { config, worktreePath, options } = ctx;

  const script = config.scripts?.find((s) => s.name === scriptName);
  if (!script) {
    return Promise.resolve({
      name: scriptName,
      success: false,
      exitCode: 1,
      skipped: true,
      reason: `Script not found: ${scriptName}`,
    });
  }

  const description = script.description ?? script.name;
  const optionalTag = script.optional ? gray(" (optional)") : "";
  console.log(`\n${bold("→")} ${description}${optionalTag}`);

  return executeScript(script, worktreePath, options.dryRun, options.verbose);
}

/**
 * Run all scripts from configuration
 */
export async function runAllScripts(
  ctx: ExecutionContext,
): Promise<ScriptResult[]> {
  const { config } = ctx;
  const results: ScriptResult[] = [];

  if (!config.scripts || config.scripts.length === 0) {
    return results;
  }

  for (const script of config.scripts) {
    const result = await runScript(ctx, script.name);
    results.push(result);

    // Stop on first non-optional failure
    if (!result.success) {
      break;
    }
  }

  return results;
}

/**
 * Run specific scripts by name
 */
export async function runScripts(
  ctx: ExecutionContext,
  scriptNames: string[],
): Promise<ScriptResult[]> {
  const results: ScriptResult[] = [];

  for (const name of scriptNames) {
    const result = await runScript(ctx, name);
    results.push(result);

    // Stop on first failure
    if (!result.success) {
      break;
    }
  }

  return results;
}

/**
 * Print script execution summary
 */
export function printScriptSummary(results: ScriptResult[]): void {
  if (results.length === 0) {
    return;
  }

  console.log("\n" + bold("Script Summary:"));

  for (const result of results) {
    const icon = result.success
      ? green("✓")
      : result.skipped
      ? yellow("○")
      : red("✗");
    const status = result.success
      ? green("success")
      : result.skipped
      ? yellow("skipped")
      : red("failed");
    const reason = result.reason ? gray(` - ${result.reason}`) : "";
    console.log(`  ${icon} ${result.name}: ${status}${reason}`);
  }
}
