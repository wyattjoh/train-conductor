/**
 * Git worktree detection and management
 */

import type { Worktree } from "./types.ts";

/**
 * Parse the porcelain output of `git worktree list --porcelain`
 *
 * Example output:
 * ```
 * worktree /path/to/main
 * HEAD abc123
 * branch refs/heads/main
 *
 * worktree /path/to/feature
 * HEAD def456
 * branch refs/heads/feature
 * ```
 */
export function parseWorktreeListOutput(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const blocks = output.trim().split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split("\n");
    const worktree: Partial<Worktree> = { isMain: false };

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktree.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        worktree.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // Branch is in format refs/heads/branch-name
        const fullRef = line.slice("branch ".length);
        worktree.branch = fullRef.replace("refs/heads/", "");
      }
    }

    // Validate we have required fields
    if (worktree.path && worktree.head) {
      worktrees.push(worktree as Worktree);
    }
  }

  // The first worktree in the list is the main worktree
  if (worktrees.length > 0) {
    worktrees[0].isMain = true;
  }

  return worktrees;
}

/**
 * Get all git worktrees for the current repository
 */
export async function getWorktrees(): Promise<Worktree[]> {
  const command = new Deno.Command("git", {
    args: ["worktree", "list", "--porcelain"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr).trim();
    throw new Error(`Failed to list worktrees: ${errorMessage}`);
  }

  const output = new TextDecoder().decode(stdout);
  return parseWorktreeListOutput(output);
}

/**
 * Get the main (root) worktree path
 */
export async function getMainWorktreePath(): Promise<string> {
  const worktrees = await getWorktrees();
  const main = worktrees.find((wt) => wt.isMain);

  if (!main) {
    throw new Error("Could not find main worktree");
  }

  return main.path;
}

/**
 * Get all worktrees except the main one
 */
export async function getNonMainWorktrees(): Promise<Worktree[]> {
  const worktrees = await getWorktrees();
  return worktrees.filter((wt) => !wt.isMain);
}

/**
 * Check if the current directory is inside a git worktree
 */
export async function isInWorktree(): Promise<boolean> {
  const command = new Deno.Command("git", {
    args: ["rev-parse", "--is-inside-work-tree"],
    stdout: "piped",
    stderr: "null",
  });

  const { code, stdout } = await command.output();

  if (code !== 0) {
    return false;
  }

  const output = new TextDecoder().decode(stdout).trim();
  return output === "true";
}

/**
 * Get the root directory of the current git repository/worktree
 */
export async function getCurrentWorktreeRoot(): Promise<string> {
  const command = new Deno.Command("git", {
    args: ["rev-parse", "--show-toplevel"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr).trim();
    throw new Error(`Failed to get worktree root: ${errorMessage}`);
  }

  return new TextDecoder().decode(stdout).trim();
}
