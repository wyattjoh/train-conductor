# 🔗 conduit

A CLI tool for setting up git worktrees with symlinks and scripts. conduit reads
configuration from `.conductor.local.toml` in your repository root and creates
symlinks from the main worktree to secondary worktrees, with support for running
post-setup scripts.

## Features

- **Tree symlinks**: Recursively link directories at the leaf (file) level,
  preserving local overrides in the target worktree
- **Normal symlinks**: Glob-based file/directory linking for simple patterns
- **Post-setup scripts**: Run shell commands after symlinking (e.g.,
  `npm install`)
- **Worktree mode**: Run setup across all git worktrees at once
- **Interactive mode**: Select which operations to run via a menu
- **Dry-run mode**: Preview changes without making them

## Installation

### From JSR (recommended)

Requires [Deno](https://deno.land/) v2.0 or later.

```bash
deno install -g --allow-read --allow-write --allow-run --allow-env -n conduit jsr:@wyattjoh/conduit
```

### Run without installing

```bash
deno run --allow-read --allow-write --allow-run --allow-env jsr:@wyattjoh/conduit setup
```

### From source

```bash
# Clone the repository
git clone https://github.com/wyattjoh/conduit.git
cd conduit

# Install globally
deno task install
```

### Compile to standalone binary

```bash
deno task compile

# Move to your PATH
mv conduit ~/.local/bin/
```

## Usage

```
conduit <command> [OPTIONS]

COMMANDS:
  setup       Run worktree setup (symlinks + scripts)
  validate    Validate configuration file without running setup
  init        Create a default .conductor.local.toml template

OPTIONS:
  -h, --help              Show help message
  -i, --interactive       Select operations via interactive menu (setup only)
  -o, --only <list>       Run only specific operations (setup only)
                          Values: symlinks, <script-name>, all
  -w, --worktrees         Run across all git worktrees (setup only)
  -c, --config <path>     Override config file path
  -n, --dry-run           Show what would be done without changes (setup only)
  -v, --verbose           Verbose output
      --version           Show version number
```

### Examples

```bash
# Create a default configuration file
conduit init

# Validate the configuration file
conduit validate

# Run all operations (symlinks + all scripts)
conduit setup

# Symlinks only
conduit setup -o symlinks

# Symlinks + specific script
conduit setup -o symlinks,install

# Run in all worktrees
conduit setup -w

# Interactive mode
conduit setup -i

# Dry run (preview changes)
conduit setup -n
```

## Configuration

Create a `.conductor.local.toml` file in your repository root:

```toml
# Optional: override auto-detected root path
# root = "/path/to/repo"

[symlinks]
# Tree symlinks: recursively link at file level, preserving local overrides
tree = [".zed", ".claude", "node_modules"]

# Normal symlinks: glob patterns for direct file/directory linking
normal = [".env", "CLAUDE.local.md"]

# Object syntax also supported for both:
# tree = [{ path = "node_modules" }]
# normal = [{ pattern = ".env" }]

[[scripts]]
name = "install"
description = "Install dependencies"
command = "npm install"
optional = false

[[scripts]]
name = "build"
description = "Build the project"
command = "npm run build"
optional = true  # Won't fail if this script fails
```

### Symlink Types

**Tree symlinks** (`symlinks.tree`):

- Recursively walks the source directory
- Creates symlinks at the leaf (file) level
- Preserves any files that already exist in the target (local overrides)
- Ideal for: `node_modules`, `.zed`, `.claude` directories

**Normal symlinks** (`symlinks.normal`):

- Supports glob patterns
- Creates direct symlinks to files or directories
- Overwrites existing symlinks but skips regular files/directories
- Ideal for: `.env`, config files, specific patterns like `**/*.local.md`

### Scripts

Scripts run in order after symlinks are created. Each script can have:

- `name` (required): Unique identifier, used with `--only`
- `command` (required): Shell command to execute
- `description` (optional): Human-readable description
- `optional` (optional): If `true`, failure won't stop execution

## How It Works

1. Detects if you're in a git worktree
2. Finds the main worktree path
3. Loads `.conductor.local.toml` from the main worktree
4. Determines which operations to run (all, `--only` subset, or interactive)
5. Creates symlinks (tree first, then normal)
6. Runs scripts in order, stopping on first non-optional failure

## Security Considerations

**Important:** The `.conductor.local.toml` file contains shell commands that are
executed directly via `bash -c`. Treat this file as executable code:

- Only use configuration files from sources you trust
- Review the `[[scripts]]` section before running `conduit` in a new repository
- Consider adding `.conductor.local.toml` to `.gitignore` if it contains
  environment-specific commands

## Development

```bash
# Run in development mode
deno task dev

# Run tests
deno test

# Type check
deno check src/**/*.ts

# Lint
deno lint

# Format
deno fmt
```

## License

MIT
