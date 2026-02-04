import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { getSkillDiscoveryPaths } from './skill-paths.ts';

const CLONE_TIMEOUT_MS = 60000; // 60 seconds

export class GitCloneError extends Error {
  readonly url: string;
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;

  constructor(message: string, url: string, isTimeout = false, isAuthError = false) {
    super(message);
    this.name = 'GitCloneError';
    this.url = url;
    this.isTimeout = isTimeout;
    this.isAuthError = isAuthError;
  }
}

/**
 * Clone a repository with sparse checkout optimization for large repos.
 *
 * Uses partial clone (--filter=blob:none) with sparse checkout to only
 * download skill-related directories, dramatically reducing clone time
 * for large repositories like vercel/turborepo.
 *
 * Falls back to regular shallow clone if sparse checkout is not supported
 * (Git < 2.25).
 */
export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });

  // Try sparse clone first (faster for large repos)
  const sparseCloneOptions = ref
    ? ['--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref]
    : ['--depth', '1', '--filter=blob:none', '--sparse'];

  const regularCloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    await git.clone(url, tempDir, sparseCloneOptions);

    // Set up sparse-checkout to fetch only skill-related directories
    const repoGit = simpleGit(tempDir, { timeout: { block: CLONE_TIMEOUT_MS } });
    try {
      const skillPaths = getSkillDiscoveryPaths();
      await repoGit.raw(['sparse-checkout', 'set', ...skillPaths]);
    } catch {
      // If sparse-checkout fails, disable sparse mode to get all files
      // This can happen if the repo structure doesn't match expected paths
      await repoGit.raw(['sparse-checkout', 'disable']).catch(() => {});
    }

    return tempDir;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // If sparse clone failed due to unsupported Git options, try regular clone
    // This provides backwards compatibility with older Git versions (< 2.25)
    if (
      errorMessage.includes('unknown option') ||
      errorMessage.includes('unrecognized argument') ||
      errorMessage.includes('invalid filter-spec') ||
      errorMessage.includes('--filter')
    ) {
      // Clean up failed sparse clone attempt
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});

      const retryTempDir = await mkdtemp(join(tmpdir(), 'skills-'));
      try {
        await git.clone(url, retryTempDir, regularCloneOptions);
        return retryTempDir;
      } catch (retryError) {
        await rm(retryTempDir, { recursive: true, force: true }).catch(() => {});
        // Continue to error handling with the retry error
        error = retryError;
      }
    }

    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});

    const finalErrorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout =
      finalErrorMessage.includes('block timeout') || finalErrorMessage.includes('timed out');
    const isAuthError =
      finalErrorMessage.includes('Authentication failed') ||
      finalErrorMessage.includes('could not read Username') ||
      finalErrorMessage.includes('Permission denied') ||
      finalErrorMessage.includes('Repository not found');

    if (isTimeout) {
      throw new GitCloneError(
        `Clone timed out after 60s. This can happen with:\n` +
          `  - Private repos that require authentication\n` +
          `  - Very large repositories\n\n` +
          `  For authentication issues:\n` +
          `  - For SSH: ssh-add -l (to check loaded keys)\n` +
          `  - For HTTPS: gh auth status (if using GitHub CLI)\n\n` +
          `  For large repos, try installing from a smaller fork or contact the skill author.`,
        url,
        true,
        false
      );
    }

    if (isAuthError) {
      throw new GitCloneError(
        `Authentication failed for ${url}.\n` +
          `  - For private repos, ensure you have access\n` +
          `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
          `  - For HTTPS: Run 'gh auth login' or configure git credentials`,
        url,
        false,
        true
      );
    }

    throw new GitCloneError(`Failed to clone ${url}: ${finalErrorMessage}`, url, false, false);
  }
}

export async function cleanupTempDir(dir: string): Promise<void> {
  // Validate that the directory path is within tmpdir to prevent deletion of arbitrary paths
  const normalizedDir = normalize(resolve(dir));
  const normalizedTmpDir = normalize(resolve(tmpdir()));

  if (!normalizedDir.startsWith(normalizedTmpDir + sep) && normalizedDir !== normalizedTmpDir) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  await rm(dir, { recursive: true, force: true });
}
