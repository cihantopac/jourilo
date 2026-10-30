// The plugin must invoke the real toolchain: every skill pre-approves exactly the bundled CLI, and every command a
// skill mentions must exist in the CLI registry.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/registry.js';

const root = join(import.meta.dirname, '..', '..');
const plugin = join(root, 'plugin');
const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('Claude Code plugin', () => {
  const skills = readdirSync(join(plugin, 'skills'));
  it('ships the documented commands as skills', () => {
    for (const s of [
      'jourilo',
      'audit',
      'discover',
      'journeys',
      'accessibility',
      'conversion',
      'optimize',
      'compare',
      'report',
      'experiment',
    ])
      expect(skills).toContain(s);
  });
  it.each(readdirSync(join(plugin, 'skills')))('skill %s has valid frontmatter and real commands', (name) => {
    const md = readFileSync(join(plugin, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(fm).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(fm).toMatch(/^description: .{40,}/m);
    expect(fm).toContain('Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/jourilo.mjs" *)');
    const names = new Set(COMMANDS.map((c) => c.name));
    for (const m of md.matchAll(/`jourilo ([a-z-]+)/g))
      expect(names.has(m[1]!), `jourilo ${m[1]} in ${name}`).toBe(true);
  });
  it('keeps manifests and versions consistent', () => {
    const pkg = json('package.json');
    const manifest = json('plugin/.claude-plugin/plugin.json');
    const market = json('.claude-plugin/marketplace.json');
    expect(manifest.name).toBe('jourilo');
    expect(manifest.version).toBe(pkg.version);
    expect(market.plugins[0].version).toBe(pkg.version);
    expect(market.plugins[0].source).toBe('./plugin');
    // Runtime dependency is pinned exactly and matches the development version.
    expect(json('plugin/package.json').dependencies['playwright-core']).toBe(
      pkg.dependencies['playwright-core'],
    );
    expect(json('plugin/package-lock.json').packages['node_modules/playwright-core'].version).toBe(
      pkg.dependencies['playwright-core'],
    );
  });
  it('agent definitions only pre-approve the toolchain', () => {
    for (const f of readdirSync(join(plugin, 'agents'))) {
      const md = readFileSync(join(plugin, 'agents', f), 'utf8');
      const tools = md.match(/^tools: (.*)$/m)?.[1] ?? '';
      expect(tools).not.toMatch(/Bash(?!\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/jourilo\.mjs")/);
    }
  });
});
