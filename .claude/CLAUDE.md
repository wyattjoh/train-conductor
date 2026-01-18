# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

train-conductor is a Deno CLI tool for setting up git worktrees with symlinks
and scripts. It reads configuration from `.conductor.local.toml` in the
repository root and creates symlinks from the main worktree to secondary
worktrees, with support for running post-setup scripts.

## Commands

```bash
# Run in development mode
deno task dev

# Compile to standalone binary
deno task compile

# Install globally
deno task install

# Run directly with permissions
deno run --allow-read --allow-write --allow-run --allow-env src/main.ts
```

## Architecture

The codebase follows a functional style with clear module separation:

- **main.ts** - CLI entry point, argument parsing, orchestrates worktree setup
  flow
- **types.ts** - TypeScript interfaces for all data structures (Config,
  Worktree, CliOptions, results)
- **config.ts** - TOML configuration loading/validation from
  `.conductor.local.toml`
- **worktree.ts** - Git worktree detection/management via
  `git worktree list --porcelain`
- **symlinks.ts** - Two symlink modes:
  - **Tree symlinks**: Recursive directory linking at leaf (file) level,
    preserving local overrides
  - **Normal symlinks**: Glob-based file/directory linking
- **scripts.ts** - Shell script execution with streaming output via `bash -c`
- **interactive.ts** - Interactive menu using @cliffy/prompt for operation
  selection

### Key Flow

1. Detect if in git worktree, get main worktree path
2. Load `.conductor.local.toml` from main worktree
3. Determine operations (all, --only subset, or interactive selection)
4. Process symlinks (tree first, then normal)
5. Run scripts in order, stopping on first non-optional failure

### Configuration Format

```toml
[symlinks]
tree = [{ path = "node_modules" }]
normal = [{ pattern = ".env" }]

[[scripts]]
name = "install"
description = "Install dependencies"
command = "npm install"
optional = false
```

## Dependencies

Uses Deno standard library modules from JSR:

- `@std/toml` - TOML parsing
- `@std/path` - Path operations
- `@std/fs` - File system utilities (ensureDir, expandGlob)
- `@std/fmt` - Terminal colors
- `@std/cli` - Argument parsing
