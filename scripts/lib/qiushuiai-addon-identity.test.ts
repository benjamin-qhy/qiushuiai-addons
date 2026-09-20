import { describe, expect, test } from 'bun:test';
import {
  QIUSHUIAI_ADDON_SOURCE,
  catalogEntryFromManifest,
  parseAddonPackageName,
  tarballFileName,
  validateCatalog,
  type QiushuiAIAddonCatalog,
} from './qiushuiai-addon-identity';

const manifest = {
  name: '@qiushuiai/qiushuiai-addon-goal',
  version: '0.1.49',
  description: '提供持久化目标管理和自动续行能力',
  qiushuiai: {
    displayName: '目标管理',
    type: 'extension',
    compatibleVersions: '>=3.0.0',
    categories: ['goal', 'automation', 'productivity'],
    displayTags: ['目标', '自动化', '效率'],
    featured: true,
  },
};

describe('QiushuiAI add-on identity', () => {
  test('parses the canonical package name', () => {
    expect(parseAddonPackageName(manifest.name)).toBe('goal');
    expect(() => parseAddonPackageName('@rcarmo/piclaw-addon-goal')).toThrow();
  });

  test('derives the public tarball name', () => {
    expect(tarballFileName(manifest)).toBe('qiushuiai-addon-goal-0.1.49.tgz');
  });

  test('builds and validates a catalog entry', () => {
    const entry = catalogEntryFromManifest(manifest, 'goal');
    const catalog = {
      version: 3,
      source: QIUSHUIAI_ADDON_SOURCE,
      addons: [entry],
    } satisfies QiushuiAIAddonCatalog;
    expect(() => validateCatalog(catalog, 1)).not.toThrow();
    expect(entry.install.spec).toBe(
      'https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-goal-0.1.49.tgz',
    );
  });
});
