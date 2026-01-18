/**
 * Tests for configuration parsing and validation
 */

import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  getOperationNames,
  SYMLINKS_OPERATION,
  validateConfig,
} from "./config.ts";

Deno.test("validateConfig - string array syntax for tree symlinks", () => {
  const toml = `
[symlinks]
tree = [".zed", ".claude", ".conductor"]
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks?.tree, [
    { path: ".zed" },
    { path: ".claude" },
    { path: ".conductor" },
  ]);
});

Deno.test("validateConfig - string array syntax for normal symlinks", () => {
  const toml = `
[symlinks]
normal = ["CLAUDE.local.md", "**/CLAUDE.local.md"]
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks?.normal, [
    { pattern: "CLAUDE.local.md" },
    { pattern: "**/CLAUDE.local.md" },
  ]);
});

Deno.test("validateConfig - object syntax still works (backwards compatibility)", () => {
  const toml = `
[[symlinks.tree]]
path = ".zed"

[[symlinks.normal]]
pattern = "CLAUDE.local.md"
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks?.tree, [{ path: ".zed" }]);
  assertEquals(config.symlinks?.normal, [{ pattern: "CLAUDE.local.md" }]);
});

Deno.test("validateConfig - mixed arrays work (string and object)", () => {
  const toml = `
[symlinks]
tree = [".zed", { path = ".claude" }]
normal = ["CLAUDE.local.md", { pattern = "**/.env" }]
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks?.tree, [
    { path: ".zed" },
    { path: ".claude" },
  ]);
  assertEquals(config.symlinks?.normal, [
    { pattern: "CLAUDE.local.md" },
    { pattern: "**/.env" },
  ]);
});

Deno.test("validateConfig - error for invalid tree symlink type", () => {
  const toml = `
[symlinks]
tree = [123]
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "symlinks.tree[0] must be a string or object",
  );
});

Deno.test("validateConfig - error for invalid normal symlink type", () => {
  const toml = `
[symlinks]
normal = [true]
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "symlinks.normal[0] must be a string or object",
  );
});

Deno.test("validateConfig - error for object without required path field", () => {
  const toml = `
[symlinks]
tree = [{ notPath = "value" }]
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "symlinks.tree[0].path must be a string",
  );
});

Deno.test("validateConfig - error for object without required pattern field", () => {
  const toml = `
[symlinks]
normal = [{ notPattern = "value" }]
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "symlinks.normal[0].pattern must be a string",
  );
});

// Scripts validation tests

Deno.test("validateConfig - scripts with all fields", () => {
  const toml = `
[[scripts]]
name = "install"
description = "Install dependencies"
command = "npm install"
optional = true
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.scripts?.length, 1);
  assertEquals(config.scripts?.[0], {
    name: "install",
    description: "Install dependencies",
    command: "npm install",
    optional: true,
  });
});

Deno.test("validateConfig - scripts with required fields only", () => {
  const toml = `
[[scripts]]
name = "build"
command = "npm run build"
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.scripts?.length, 1);
  assertEquals(config.scripts?.[0], {
    name: "build",
    command: "npm run build",
  });
});

Deno.test("validateConfig - multiple scripts", () => {
  const toml = `
[[scripts]]
name = "install"
command = "npm install"

[[scripts]]
name = "build"
command = "npm run build"

[[scripts]]
name = "test"
command = "npm test"
optional = true
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.scripts?.length, 3);
  assertEquals(config.scripts?.[0].name, "install");
  assertEquals(config.scripts?.[1].name, "build");
  assertEquals(config.scripts?.[2].name, "test");
  assertEquals(config.scripts?.[2].optional, true);
});

Deno.test("validateConfig - error for script without name", () => {
  const toml = `
[[scripts]]
command = "npm install"
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "scripts[0].name must be a string",
  );
});

Deno.test("validateConfig - error for script without command", () => {
  const toml = `
[[scripts]]
name = "install"
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "scripts[0].command must be a string",
  );
});

Deno.test("validateConfig - error for script that is not an object", () => {
  const toml = `
scripts = ["not an object"]
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "scripts[0] must be an object",
  );
});

Deno.test("validateConfig - error for duplicate script names", () => {
  const toml = `
[[scripts]]
name = "install"
command = "npm install"

[[scripts]]
name = "install"
command = "yarn install"
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    'scripts[1].name "install" is a duplicate',
  );
});

// Root path validation

Deno.test("validateConfig - root path string", () => {
  const toml = `
root = "/custom/path"
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.root, "/custom/path");
});

Deno.test("validateConfig - error for non-string root", () => {
  const toml = `
root = 123
`;
  const parsed = parseToml(toml);

  assertThrows(
    () => validateConfig(parsed),
    Error,
    "root must be a string if provided",
  );
});

// Empty/minimal config

Deno.test("validateConfig - empty config", () => {
  const config = validateConfig({});

  assertEquals(config.root, undefined);
  assertEquals(config.symlinks, undefined);
  assertEquals(config.scripts, undefined);
});

Deno.test("validateConfig - config with only symlinks", () => {
  const toml = `
[symlinks]
tree = [".zed"]
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks?.tree, [{ path: ".zed" }]);
  assertEquals(config.scripts, undefined);
});

Deno.test("validateConfig - config with only scripts", () => {
  const toml = `
[[scripts]]
name = "test"
command = "npm test"
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);

  assertEquals(config.symlinks, undefined);
  assertEquals(config.scripts?.length, 1);
});

// getOperationNames tests

Deno.test("getOperationNames - empty config", () => {
  const config = validateConfig({});
  const ops = getOperationNames(config);

  assertEquals(ops, [SYMLINKS_OPERATION]);
});

Deno.test("getOperationNames - config with scripts", () => {
  const toml = `
[[scripts]]
name = "install"
command = "npm install"

[[scripts]]
name = "build"
command = "npm run build"
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);
  const ops = getOperationNames(config);

  assertEquals(ops, [SYMLINKS_OPERATION, "install", "build"]);
});

Deno.test("getOperationNames - config with only symlinks", () => {
  const toml = `
[symlinks]
tree = [".zed"]
`;
  const parsed = parseToml(toml);
  const config = validateConfig(parsed);
  const ops = getOperationNames(config);

  assertEquals(ops, [SYMLINKS_OPERATION]);
});
