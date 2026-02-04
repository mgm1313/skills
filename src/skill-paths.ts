import { join } from 'path';
import { agents } from './agents.ts';

/**
 * Special skill discovery directories that are not agent-specific.
 * These are checked in addition to agent skillsDir paths.
 */
const SPECIAL_SKILL_DIRS = ['skills', '.claude-plugin', 'plugins'];

/**
 * Get all directory paths that should be checked for skills during sparse checkout.
 * This is the single source of truth for skill discovery paths, used by both
 * the git sparse checkout and the skill discovery logic.
 *
 * Note: Only directories are returned since git sparse-checkout requires directories.
 * Root-level files like SKILL.md are handled separately during discovery.
 *
 * @returns Array of directory paths relative to repo root
 */
export function getSkillDiscoveryPaths(): string[] {
  // Extract unique skillsDir values from all agents
  const agentPaths = new Set<string>();
  for (const config of Object.values(agents)) {
    if (config.skillsDir) {
      // Remove trailing slash if present for consistency
      const path = config.skillsDir.endsWith('/')
        ? config.skillsDir.slice(0, -1)
        : config.skillsDir;
      agentPaths.add(path);
    }
  }

  return [...SPECIAL_SKILL_DIRS, ...agentPaths];
}

/**
 * Get skill discovery paths as absolute paths relative to a base path.
 * Used by discoverSkills() to build the search directories.
 *
 * @param basePath - The base path to prepend to each skill path
 * @returns Array of absolute paths to search for skills
 */
export function getSkillSearchDirs(basePath: string): string[] {
  // Start with the base path itself
  const dirs = [basePath];

  // Add special directories
  dirs.push(
    join(basePath, 'skills'),
    join(basePath, 'skills/.curated'),
    join(basePath, 'skills/.experimental'),
    join(basePath, 'skills/.system')
  );

  // Add agent-specific directories
  for (const config of Object.values(agents)) {
    if (config.skillsDir) {
      dirs.push(join(basePath, config.skillsDir));
    }
  }

  return dirs;
}
