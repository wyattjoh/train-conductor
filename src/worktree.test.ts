/**
 * Tests for git worktree parsing
 */

import { assertEquals } from "@std/assert";
import { parseWorktreeListOutput } from "./worktree.ts";

Deno.test("parseWorktreeListOutput - single main worktree", () => {
  const output = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main
`;

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 1);
  assertEquals(result[0].path, "/path/to/main");
  assertEquals(result[0].head, "abc123def456");
  assertEquals(result[0].branch, "main");
  assertEquals(result[0].isMain, true);
});

Deno.test("parseWorktreeListOutput - multiple worktrees", () => {
  const output = `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature-1
HEAD def456
branch refs/heads/feature-1

worktree /path/to/feature-2
HEAD 789abc
branch refs/heads/feature-2
`;

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 3);

  // First is main
  assertEquals(result[0].path, "/path/to/main");
  assertEquals(result[0].branch, "main");
  assertEquals(result[0].isMain, true);

  // Others are not main
  assertEquals(result[1].path, "/path/to/feature-1");
  assertEquals(result[1].branch, "feature-1");
  assertEquals(result[1].isMain, false);

  assertEquals(result[2].path, "/path/to/feature-2");
  assertEquals(result[2].branch, "feature-2");
  assertEquals(result[2].isMain, false);
});

Deno.test("parseWorktreeListOutput - detached HEAD (no branch)", () => {
  const output = `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/detached
HEAD def456
`;

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 2);
  assertEquals(result[1].path, "/path/to/detached");
  assertEquals(result[1].head, "def456");
  assertEquals(result[1].branch, undefined);
  assertEquals(result[1].isMain, false);
});

Deno.test("parseWorktreeListOutput - empty output", () => {
  const output = "";

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 0);
});

Deno.test("parseWorktreeListOutput - whitespace only", () => {
  const output = "   \n\n   ";

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 0);
});

Deno.test("parseWorktreeListOutput - branch with slashes", () => {
  const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/feature/my-feature/sub-task
`;

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 1);
  assertEquals(result[0].branch, "feature/my-feature/sub-task");
});

Deno.test("parseWorktreeListOutput - paths with spaces", () => {
  const output = `worktree /path/to/my project/main
HEAD abc123
branch refs/heads/main
`;

  const result = parseWorktreeListOutput(output);

  assertEquals(result.length, 1);
  assertEquals(result[0].path, "/path/to/my project/main");
});

Deno.test("parseWorktreeListOutput - skips blocks without required fields", () => {
  const output = `worktree /valid/path
HEAD abc123

worktree /missing/head

HEAD orphan123
branch refs/heads/orphan
`;

  const result = parseWorktreeListOutput(output);

  // Only the first block has both worktree and HEAD
  assertEquals(result.length, 1);
  assertEquals(result[0].path, "/valid/path");
});
