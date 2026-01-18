/**
 * Configuration types for train
 */

/**
 * A tree symlink configuration - recursively links directories
 * while preserving any local overrides in the target.
 */
export interface TreeSymlinkConfig {
  /** Relative path from repo root to the directory to symlink */
  path: string;
}

/**
 * A normal symlink configuration - direct file/glob patterns
 */
export interface NormalSymlinkConfig {
  /** Glob pattern or exact path to symlink */
  pattern: string;
}

/**
 * Exclusion configuration for glob patterns
 */
export interface ExcludeConfig {
  /** Glob patterns to exclude from matching */
  patterns: string[];
  /** If true, replace default exclusions instead of extending them */
  replaceDefaults?: boolean;
}

/**
 * Symlinks configuration section
 */
export interface SymlinksConfig {
  /** Tree-style symlinks (recursive with local override preservation) */
  tree?: TreeSymlinkConfig[];
  /** Normal symlinks (direct file/glob patterns) */
  normal?: NormalSymlinkConfig[];
  /** Exclusion patterns for glob matching (applies to normal symlinks with **) */
  exclude?: ExcludeConfig;
}

/**
 * A post-linking script configuration
 */
export interface ScriptConfig {
  /** Unique identifier for the script */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Shell command to execute */
  command: string;
  /** If true, don't fail if the command fails or tool is missing */
  optional?: boolean;
}

/**
 * The complete configuration file structure
 */
export interface Config {
  /** Optional: Override auto-detected root path */
  root?: string;
  /** Symlink configurations */
  symlinks?: SymlinksConfig;
  /** Post-linking scripts to run */
  scripts?: ScriptConfig[];
}

/**
 * Parsed worktree information from git
 */
export interface Worktree {
  /** Absolute path to the worktree directory */
  path: string;
  /** Git commit HEAD is pointing to */
  head: string;
  /** Branch name (if on a branch) */
  branch?: string;
  /** Whether this is the main worktree */
  isMain: boolean;
}

/**
 * CLI options parsed from arguments
 */
export interface CliOptions {
  /** Show help message */
  help: boolean;
  /** Interactive mode */
  interactive: boolean;
  /** Run only specific operations */
  only?: string[];
  /** Run across all git worktrees */
  worktrees: boolean;
  /** Override config file path */
  configPath?: string;
  /** Dry run mode - show what would be done */
  dryRun: boolean;
  /** Verbose output */
  verbose: boolean;
  /** Subcommand if any (e.g., "validate", "init") */
  subcommand?: string;
}

/**
 * Result of a symlink operation
 */
export interface SymlinkResult {
  /** Source path (in main repo) */
  source: string;
  /** Target path (in worktree) */
  target: string;
  /** Whether the operation was successful */
  success: boolean;
  /** Type of operation performed */
  action: "created" | "skipped" | "error";
  /** Reason for skip or error message */
  reason?: string;
}

/**
 * Result of a script execution
 */
export interface ScriptResult {
  /** Script name */
  name: string;
  /** Whether the script succeeded */
  success: boolean;
  /** Exit code */
  exitCode: number;
  /** Whether the script was skipped */
  skipped: boolean;
  /** Reason for skip or error message */
  reason?: string;
}

/**
 * Overall execution context
 */
export interface ExecutionContext {
  /** Root repository path (main worktree) */
  rootPath: string;
  /** Current worktree path (may be same as rootPath) */
  worktreePath: string;
  /** Parsed configuration */
  config: Config;
  /** CLI options */
  options: CliOptions;
}
