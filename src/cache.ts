import { readFile } from "node:fs/promises";

export type MangleCache = Record<string, string>;

interface TerserNameCache {
  props: {
    props: Record<string, string>;
  };
  vars: {
    props: Record<string, string>;
  };
}

export async function readMangleCache(cachePath: string): Promise<MangleCache> {
  let source: string;

  try {
    source = await readFile(cachePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse cache file ${cachePath}`, { cause: error });
  }

  return validateMangleCache(value, cachePath);
}

export function toTerserNameCache(cache: MangleCache): TerserNameCache {
  return {
    props: {
      props: Object.fromEntries(Object.entries(cache).map(([name, mangled]) => [`$${name}`, mangled])),
    },
    vars: {
      props: {},
    },
  };
}

export function fromTerserNameCache(nameCache: TerserNameCache): MangleCache {
  const cache: MangleCache = {};

  for (const [name, mangled] of Object.entries(nameCache.props.props)) {
    cache[name.slice(1)] = mangled;
  }

  return cache;
}

export function serializeMangleCache(cache: MangleCache): string {
  return `${JSON.stringify(cache, null, 2)}\n`;
}

function validateMangleCache(value: unknown, cachePath: string): MangleCache {
  if (!isRecord(value)) {
    throw new TypeError(`Cache file ${cachePath} must contain a JSON object`);
  }

  const cache: MangleCache = {};
  const owners = new Map<string, string>();

  for (const [name, mangled] of Object.entries(value)) {
    if (typeof mangled !== "string" || !mangled) {
      throw new TypeError(`Cache entry ${JSON.stringify(name)} in ${cachePath} must map to a non-empty string`);
    }

    const owner = owners.get(mangled);
    if (owner && owner !== name) {
      throw new Error(
        `Cache entries ${JSON.stringify(owner)} and ${JSON.stringify(name)} in ${cachePath} both map to ${JSON.stringify(mangled)}`,
      );
    }

    cache[name] = mangled;
    owners.set(mangled, name);
  }

  return cache;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
