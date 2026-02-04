import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { getSkillDiscoveryPaths } from './skill-paths.ts';

const CLONE_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Repo size threshold (in KB) above which sparse checkout is used.
 * For repos below this size, shallow clone is faster due to lower overhead.
 * 50MB threshold based on benchmarks showing sparse checkout adds ~1.5s overhead.
 */
const SPARSE_CLONE_SIZE_THRESHOLD_KB = 50000; // 50MB

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
 * Clone a repository with optional sparse checkout optimization for large repos.
 *
 * For large repos (> 50MB), uses partial clone (--filter=blob:none) with sparse
 * checkout to only download skill-related directories, dramatically reducing
 * clone time for large repositories like vercel/turborepo.
 *
 * For smaller repos, uses regular shallow clone which is faster due to
 * lower overhead.
 *
 * @param url - The repository URL to clone
 * @param ref - Optional branch/tag to checkout
 * @param repoSizeKB - Optional repo size in KB. If > threshold, uses sparse clone.
 *                     If null/undefined, defaults to shallow clone (safe default).
 */
export async function cloneRepo(
  url: string,
  ref?: string,
  repoSizeKB?: number | null
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });

  const regularCloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  // Use sparse clone only for large repos (> 50MB)
  // For smaller repos, shallow clone is faster due to less overhead
  const useSparseClone = repoSizeKB != null && repoSizeKB > SPARSE_CLONE_SIZE_THRESHOLD_KB;

  if (!useSparseClone) {
    // Regular shallow clone for small/medium repos
    try {
      await git.clone(url, tempDir, regularCloneOptions);
      return tempDir;
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw handleCloneError(error, url);
    }
  }

  // Sparse clone for large repos
  const sparseCloneOptions = ref
    ? ['--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref]
    : ['--depth', '1', '--filter=blob:none', '--sparse'];

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
        throw handleCloneError(retryError, url);
      }
    }

    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw handleCloneError(error, url);
  }
}

/**
 * Handle clone errors and convert to GitCloneError with appropriate messages.
 */
function handleCloneError(error: unknown, url: string): GitCloneError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
  const isAuthError =
    errorMessage.includes('Authentication failed') ||
    errorMessage.includes('could not read Username') ||
    errorMessage.includes('Permission denied') ||
    errorMessage.includes('Repository not found');

  if (isTimeout) {
    return new GitCloneError(
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
    return new GitCloneError(
      `Authentication failed for ${url}.\n` +
        `  - For private repos, ensure you have access\n` +
        `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
        `  - For HTTPS: Run 'gh auth login' or configure git credentials`,
      url,
      false,
      true
    );
  }

  return new GitCloneError(`Failed to clone ${url}: ${errorMessage}`, url, false, false);
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
