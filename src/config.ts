/**
 * Configuration file parsing and validation
 */

import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import type {
  Config,
  ExcludeConfig,
  ScriptConfig,
  SymlinksConfig,
  UserConfig,
} from "./types.ts";

/** Default config file name */
export const CONFIG_FILE_NAME = ".conductor.local.toml";

/** User config file path */
export const USER_CONFIG_PATH = join(
  Deno.env.get("HOME") ?? "~",
  CONFIG_FILE_NAME,
);

/** Operation name for symlinks (used across the codebase) */
export const SYMLINKS_OPERATION = "symlinks";

/**
 * Validate and normalize the exclude configuration.
 */
function validateExclude(raw: unknown): ExcludeConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const exclude = raw as Record<string, unknown>;

  if (!Array.isArray(exclude.patterns)) {
    throw new Error("symlinks.exclude.patterns must be an array of strings");
  }

  const patterns = exclude.patterns.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`symlinks.exclude.patterns[${index}] must be a string`);
    }
    return item;
  });

  const result: ExcludeConfig = { patterns };

  if (typeof exclude.replaceDefaults === "boolean") {
    result.replaceDefaults = exclude.replaceDefaults;
  } else if (exclude.replaceDefaults !== undefined) {
    throw new Error("symlinks.exclude.replaceDefaults must be a boolean");
  }

  return result;
}

/**
 * Validate and normalize the symlinks configuration.
 * Supports both string arrays and object arrays for convenience:
 *
 * String syntax (shorthand):
 *   tree = [".zed", ".claude"]
 *   normal = ["CLAUDE.local.md", ".env"]
 *
 * Object syntax (explicit):
 *   tree = [{ path = ".zed" }]
 *   normal = [{ pattern = "CLAUDE.local.md" }]
 */
function validateSymlinks(raw: unknown): SymlinksConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const symlinks = raw as Record<string, unknown>;
  const result: SymlinksConfig = {};

  if (Array.isArray(symlinks.tree)) {
    result.tree = symlinks.tree.map((item, index) => {
      if (typeof item === "string") {
        return { path: item };
      }
      if (typeof item !== "object" || item === null) {
        throw new Error(`symlinks.tree[${index}] must be a string or object`);
      }
      const obj = item as Record<string, unknown>;
      if (typeof obj.path !== "string") {
        throw new Error(`symlinks.tree[${index}].path must be a string`);
      }
      return { path: obj.path };
    });
  }

  if (Array.isArray(symlinks.normal)) {
    result.normal = symlinks.normal.map((item, index) => {
      if (typeof item === "string") {
        return { pattern: item };
      }
      if (typeof item !== "object" || item === null) {
        throw new Error(`symlinks.normal[${index}] must be a string or object`);
      }
      const obj = item as Record<string, unknown>;
      if (typeof obj.pattern !== "string") {
        throw new Error(`symlinks.normal[${index}].pattern must be a string`);
      }
      return { pattern: obj.pattern };
    });
  }

  result.exclude = validateExclude(symlinks.exclude);

  return result;
}

/**
 * Validate and normalize the scripts configuration
 */
function validateScripts(raw: unknown): ScriptConfig[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const seenNames = new Set<string>();

  return raw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`scripts[${index}] must be an object`);
    }

    const obj = item as Record<string, unknown>;

    if (typeof obj.name !== "string") {
      throw new Error(`scripts[${index}].name must be a string`);
    }

    if (typeof obj.command !== "string") {
      throw new Error(`scripts[${index}].command must be a string`);
    }

    // Check for duplicate script names
    if (seenNames.has(obj.name)) {
      throw new Error(
        `scripts[${index}].name "${obj.name}" is a duplicate (script names must be unique)`,
      );
    }
    seenNames.add(obj.name);

    const script: ScriptConfig = {
      name: obj.name,
      command: obj.command,
    };

    if (typeof obj.description === "string") {
      script.description = obj.description;
    }

    if (typeof obj.optional === "boolean") {
      script.optional = obj.optional;
    }

    return script;
  });
}

/**
 * Parse and validate a configuration object
 */
export function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") {
    throw new Error("Configuration must be an object");
  }

  const obj = raw as Record<string, unknown>;
  const config: Config = {};

  if (typeof obj.root === "string") {
    config.root = obj.root;
  } else if (obj.root !== undefined) {
    throw new Error("root must be a string if provided");
  }

  config.symlinks = validateSymlinks(obj.symlinks);
  config.scripts = validateScripts(obj.scripts);

  return config;
}

/**
 * Load and parse the configuration file
 *
 * @param configPath - Optional explicit path to config file
 * @param rootPath - Root repository path to search for config
 * @returns Parsed configuration
 */
export async function loadConfig(
  configPath: string | undefined,
  rootPath: string,
): Promise<Config> {
  const filePath = configPath ?? join(rootPath, CONFIG_FILE_NAME);

  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Configuration file not found: ${filePath}\n` +
          `Create a ${CONFIG_FILE_NAME} file in your repository root.`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read configuration file: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse TOML configuration: ${message}`);
  }

  return validateConfig(parsed);
}

/**
 * Get all operation names from a config (for interactive mode)
 */
export function getOperationNames(config: Config): string[] {
  const operations: string[] = [SYMLINKS_OPERATION];

  if (config.scripts) {
    for (const script of config.scripts) {
      operations.push(script.name);
    }
  }

  return operations;
}

/**
 * Load and parse a configuration file from an explicit path.
 * Does not require being in a git worktree.
 *
 * @param configPath - Path to the config file
 * @returns Parsed configuration
 */
export async function loadConfigStandalone(
  configPath: string,
): Promise<Config> {
  let content: string;
  try {
    content = await Deno.readTextFile(configPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read configuration file: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse TOML configuration: ${message}`);
  }

  return validateConfig(parsed);
}

/** Default configuration template for init command */
export const DEFAULT_CONFIG_TEMPLATE = `# conduit configuration
# See: https://github.com/wyattjoh/conduit

# Symlinks to create from main worktree to secondary worktrees
[symlinks]
# Tree symlinks recursively link directories, preserving local overrides
# tree = ["node_modules", ".zed"]

# Normal symlinks use glob patterns for files/directories
# normal = [".env", "*.local.*"]

# Exclusions for recursive glob patterns (** patterns)
# Default exclusions: node_modules, .git, dist, build, .next, .turbo, .vercel, .conductor
# [symlinks.exclude]
# patterns = ["**/legacy/**"]      # Add to defaults
# replaceDefaults = false          # Set true to replace defaults entirely

# Scripts to run after symlinks are created
# [[scripts]]
# name = "install"
# description = "Install dependencies"
# command = "npm install"
# optional = false
`;

/**
 * Validate and normalize user configuration
 */
function validateUserConfig(raw: unknown): UserConfig {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  const config: UserConfig = {};

  if (Array.isArray(obj.excludes)) {
    config.excludes = obj.excludes.map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`excludes[${index}] must be a string`);
      }
      return item;
    });
  } else if (obj.excludes !== undefined) {
    throw new Error("excludes must be an array of strings");
  }

  return config;
}

/**
 * Load user-level configuration from ~/.conductor.local.toml
 * Returns empty config if file doesn't exist (non-fatal)
 */
export async function loadUserConfig(): Promise<UserConfig> {
  let content: string;
  try {
    content = await Deno.readTextFile(USER_CONFIG_PATH);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // User config is optional, return empty
      return {};
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read user configuration: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse user configuration (${USER_CONFIG_PATH}): ${message}`,
    );
  }

  return validateUserConfig(parsed);
}
