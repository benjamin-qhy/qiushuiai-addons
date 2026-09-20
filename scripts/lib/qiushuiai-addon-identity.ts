export const QIUSHUIAI_ADDON_SCOPE = '@qiushuiai';
export const QIUSHUIAI_ADDON_PREFIX = 'qiushuiai-addon-';
export const QIUSHUIAI_ADDON_PACKAGE_PATTERN = /^@qiushuiai\/qiushuiai-addon-([a-z0-9][a-z0-9._-]{0,63})$/;
export const QIUSHUIAI_ADDON_SITE_URL = 'https://benjamin-qhy.github.io/qiushuiai-addons';
export const QIUSHUIAI_ADDON_SOURCE = 'github:benjamin-qhy/qiushuiai-addons';
export const QIUSHUIAI_ADDON_COMPATIBILITY = '>=3.0.0';

export interface QiushuiAIAddonManifest {
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  qiushuiai?: {
    displayName?: string;
    type?: string;
    compatibleVersions?: string;
    categories?: string[];
    displayTags?: string[];
    featured?: boolean;
  };
}

export interface CatalogPerson {
  login: string;
  url: string;
}

export interface QiushuiAIAddonCatalogEntry {
  slug: string;
  name: string;
  displayName: string;
  version: string;
  type: string;
  description: string;
  path: string;
  homepage?: string;
  categories: string[];
  displayTags: string[];
  featured: boolean;
  compatibleVersions: string;
  skills: string[];
  install: {
    kind: 'tarball';
    spec: string;
  };
  updatedAt?: string;
  owner?: CatalogPerson;
  contributors?: CatalogPerson[];
}

export interface QiushuiAIAddonCatalog {
  version: 3;
  source: typeof QIUSHUIAI_ADDON_SOURCE;
  addons: QiushuiAIAddonCatalogEntry[];
}

function requireValue(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`missing ${field}`);
  return normalized;
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function parseAddonPackageName(name: string): string {
  const match = QIUSHUIAI_ADDON_PACKAGE_PATTERN.exec(name);
  if (!match) {
    throw new Error(`package name must match ${QIUSHUIAI_ADDON_PACKAGE_PATTERN}`);
  }
  return match[1];
}

export function tarballFileName(manifest: Pick<QiushuiAIAddonManifest, 'name' | 'version'>): string {
  const name = requireValue(manifest.name, 'name');
  const version = requireValue(manifest.version, 'version');
  const slug = parseAddonPackageName(name);
  return `${QIUSHUIAI_ADDON_PREFIX}${slug}-${version}.tgz`;
}

export function catalogEntryFromManifest(
  manifest: QiushuiAIAddonManifest,
  slug: string,
  options: {
    skills?: string[];
    updatedAt?: string;
    owner?: CatalogPerson;
    contributors?: CatalogPerson[];
  } = {},
): QiushuiAIAddonCatalogEntry {
  const name = requireValue(manifest.name, 'name');
  const packageSlug = parseAddonPackageName(name);
  if (packageSlug !== slug) {
    throw new Error(`package suffix "${packageSlug}" must match directory slug "${slug}"`);
  }

  const version = requireValue(manifest.version, 'version');
  const description = requireValue(manifest.description, 'description');
  const displayName = requireValue(manifest.qiushuiai?.displayName, 'qiushuiai.displayName');
  const type = requireValue(manifest.qiushuiai?.type, 'qiushuiai.type');
  const compatibleVersions = requireValue(
    manifest.qiushuiai?.compatibleVersions,
    'qiushuiai.compatibleVersions',
  );
  const categories = uniqueSorted(manifest.qiushuiai?.categories ?? []);
  const displayTags = uniqueSorted(manifest.qiushuiai?.displayTags ?? []);

  if (!containsChinese(displayName)) throw new Error('qiushuiai.displayName must contain Chinese text');
  if (!containsChinese(description)) throw new Error('description must contain Chinese text');
  if (!categories.length) throw new Error('qiushuiai.categories must not be empty');
  if (!displayTags.length || displayTags.some((tag) => !containsChinese(tag))) {
    throw new Error('qiushuiai.displayTags must contain Chinese labels');
  }
  if (compatibleVersions !== QIUSHUIAI_ADDON_COMPATIBILITY) {
    throw new Error(`qiushuiai.compatibleVersions must be ${QIUSHUIAI_ADDON_COMPATIBILITY}`);
  }

  return {
    slug,
    name,
    displayName,
    version,
    type,
    description,
    path: `addons/${slug}`,
    ...(manifest.homepage?.trim() ? { homepage: manifest.homepage.trim() } : {}),
    categories,
    displayTags,
    featured: manifest.qiushuiai?.featured === true,
    compatibleVersions,
    skills: uniqueSorted(options.skills ?? []),
    install: {
      kind: 'tarball',
      spec: `${QIUSHUIAI_ADDON_SITE_URL}/packages/${tarballFileName(manifest)}`,
    },
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
    ...(options.owner ? { owner: options.owner } : {}),
    ...(options.contributors ? { contributors: options.contributors } : {}),
  };
}

export function validateCatalog(catalog: QiushuiAIAddonCatalog, expectedCount = 48): void {
  if (catalog.version !== 3) throw new Error('catalog version must be 3');
  if (catalog.source !== QIUSHUIAI_ADDON_SOURCE) {
    throw new Error(`catalog source must be ${QIUSHUIAI_ADDON_SOURCE}`);
  }
  if (catalog.addons.length !== expectedCount) {
    throw new Error(`catalog must contain exactly ${expectedCount} add-ons`);
  }

  const slugs = new Set<string>();
  const names = new Set<string>();
  for (const entry of catalog.addons) {
    if (slugs.has(entry.slug)) throw new Error(`duplicate catalog slug: ${entry.slug}`);
    if (names.has(entry.name)) throw new Error(`duplicate package name: ${entry.name}`);
    slugs.add(entry.slug);
    names.add(entry.name);

    const packageSlug = parseAddonPackageName(entry.name);
    if (packageSlug !== entry.slug) throw new Error(`catalog slug mismatch: ${entry.slug}`);
    if (entry.compatibleVersions !== QIUSHUIAI_ADDON_COMPATIBILITY) {
      throw new Error(`catalog compatibility mismatch: ${entry.slug}`);
    }
    if (!containsChinese(entry.displayName) || !containsChinese(entry.description)) {
      throw new Error(`catalog display text must be Chinese: ${entry.slug}`);
    }
    if (!entry.displayTags.length || entry.displayTags.some((tag) => !containsChinese(tag))) {
      throw new Error(`catalog display tags must be Chinese: ${entry.slug}`);
    }
    if (entry.install.kind !== 'tarball') throw new Error(`catalog install kind must be tarball: ${entry.slug}`);
    const expectedSpec = `${QIUSHUIAI_ADDON_SITE_URL}/packages/${QIUSHUIAI_ADDON_PREFIX}${entry.slug}-${entry.version}.tgz`;
    if (entry.install.spec !== expectedSpec) throw new Error(`catalog tarball URL mismatch: ${entry.slug}`);
  }
}
