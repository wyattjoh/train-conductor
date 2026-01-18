/**
 * Interactive menu using @cliffy/prompt
 */

import { Checkbox, type CheckboxOption, Confirm } from "@cliffy/prompt";
import type { Config } from "./types.ts";
import { SYMLINKS_OPERATION } from "./config.ts";

/**
 * Build menu items from config
 */
function buildMenuItems(config: Config): CheckboxOption<string>[] {
  const items: CheckboxOption<string>[] = [];

  // Always add symlinks first
  items.push({
    value: SYMLINKS_OPERATION,
    name: `${SYMLINKS_OPERATION} - Create/update symlinks from main repo`,
    checked: true,
  });

  // Add scripts
  if (config.scripts) {
    for (const script of config.scripts) {
      const desc = script.description ?? script.name;
      const optionalTag = script.optional ? " (optional)" : "";
      items.push({
        value: script.name,
        name: `${script.name} - ${desc}${optionalTag}`,
        checked: true,
      });
    }
  }

  return items;
}

/**
 * Show interactive multi-select menu using @cliffy/prompt
 *
 * @returns Selected operation names, or null if cancelled
 */
export async function showInteractiveMenu(
  config: Config,
): Promise<string[] | null> {
  const options = buildMenuItems(config);

  try {
    return await Checkbox.prompt<string>({
      message: "Select operations to run (space to toggle, enter to confirm):",
      options,
      confirmSubmit: false,
    });
  } catch {
    // User cancelled (Ctrl+C)
    return null;
  }
}

/**
 * Show confirmation prompt using @cliffy/prompt
 */
export async function confirmOperation(message: string): Promise<boolean> {
  try {
    return await Confirm.prompt({ message, default: true });
  } catch {
    // Ctrl+C = no
    return false;
  }
}
