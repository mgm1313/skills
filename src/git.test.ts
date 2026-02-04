import { describe, it, expect } from 'vitest';
import { getSkillDiscoveryPaths, getSkillSearchDirs } from './skill-paths.ts';

describe('skill-paths', () => {
  describe('getSkillDiscoveryPaths', () => {
    it('should return an array of paths', () => {
      const paths = getSkillDiscoveryPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('should include special skill directories', () => {
      const paths = getSkillDiscoveryPaths();
      expect(paths).toContain('skills');
      expect(paths).toContain('.claude-plugin');
    });

    it('should include agent-specific directories', () => {
      const paths = getSkillDiscoveryPaths();
      // Check for some known agent paths
      expect(paths).toContain('.claude/skills');
      expect(paths).toContain('.cursor/skills');
      expect(paths).toContain('.codex/skills');
    });

    it('should not include file patterns (only directories)', () => {
      const paths = getSkillDiscoveryPaths();
      // Files like SKILL.md and AGENTS.md should not be included
      // since git sparse-checkout requires directories
      for (const path of paths) {
        expect(path.endsWith('.md')).toBe(false);
      }
    });

    it('should not have trailing slashes', () => {
      const paths = getSkillDiscoveryPaths();
      for (const path of paths) {
        expect(path.endsWith('/')).toBe(false);
      }
    });

    it('should have mostly unique paths (some agents share skillsDir)', () => {
      const paths = getSkillDiscoveryPaths();
      const uniquePaths = new Set(paths);
      // Allow small number of duplicates since some agents share the same skillsDir
      // e.g., amp and kimi-cli both use '.agents/skills'
      expect(uniquePaths.size).toBeGreaterThanOrEqual(paths.length - 5);
    });
  });

  describe('getSkillSearchDirs', () => {
    it('should return an array of paths', () => {
      const dirs = getSkillSearchDirs('/test/path');
      expect(Array.isArray(dirs)).toBe(true);
      expect(dirs.length).toBeGreaterThan(0);
    });

    it('should include the base path', () => {
      const dirs = getSkillSearchDirs('/test/path');
      expect(dirs).toContain('/test/path');
    });

    it('should include special directories with base path', () => {
      const dirs = getSkillSearchDirs('/test/path');
      expect(dirs).toContain('/test/path/skills');
      expect(dirs).toContain('/test/path/skills/.curated');
      expect(dirs).toContain('/test/path/skills/.experimental');
      expect(dirs).toContain('/test/path/skills/.system');
    });

    it('should include agent directories with base path', () => {
      const dirs = getSkillSearchDirs('/test/path');
      expect(dirs).toContain('/test/path/.claude/skills');
      expect(dirs).toContain('/test/path/.cursor/skills');
      expect(dirs).toContain('/test/path/.codex/skills');
    });
  });
});

describe('git cloneRepo', () => {
  // Note: These tests would require mocking simple-git to avoid actual network calls.
  // For now, we just test that the module exports the expected functions.
  it('should export cloneRepo function', async () => {
    const { cloneRepo } = await import('./git.ts');
    expect(typeof cloneRepo).toBe('function');
  });

  it('should export cleanupTempDir function', async () => {
    const { cleanupTempDir } = await import('./git.ts');
    expect(typeof cleanupTempDir).toBe('function');
  });

  it('should export GitCloneError class', async () => {
    const { GitCloneError } = await import('./git.ts');
    expect(typeof GitCloneError).toBe('function');

    const error = new GitCloneError('test', 'https://example.com', true, false);
    expect(error.message).toBe('test');
    expect(error.url).toBe('https://example.com');
    expect(error.isTimeout).toBe(true);
    expect(error.isAuthError).toBe(false);
  });
});
