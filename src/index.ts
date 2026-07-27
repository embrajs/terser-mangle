import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fromTerserNameCache,
  type MangleCache,
  readMangleCache,
  serializeMangleCache,
  toTerserNameCache,
} from "./cache";
import { type ResolvedInput, resolveInputs } from "./inputs";
import { transformJavaScript } from "./transform";
import { type PendingWrite, readMode, writeBatch } from "./write";

export interface MangleOptions {
  /** Cache file owned by the consuming project. @default "mangle-cache.json" */
  cache?: string;
  /** Working directory used to resolve all relative paths. @default process.cwd() */
  cwd?: string;
  /** Files, directories, or glob patterns. @default ["dist"] */
  inputs?: readonly string[];
  /** Enable Terser compression and identifier mangling in addition to property mangling. */
  minify?: boolean;
  /** Write a single input to this file instead of changing it in place. */
  outFile?: string;
  /** Write inputs beneath this directory instead of changing them in place. */
  outDir?: string;
  /** Property names matched by this expression are eligible for mangling. @default /[^_]_$/ */
  pattern?: RegExp;
  /** Property names that must remain unchanged. */
  reserved?: readonly string[];
}

export interface MangleFileResult {
  input: string;
  output: string;
}

export interface MangleResult {
  cache: Readonly<MangleCache>;
  cachePath: string;
  files: readonly MangleFileResult[];
}

const defaultPattern = /[^_]_$/;

export async function mangle(options: MangleOptions = {}): Promise<MangleResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const cachePath = path.resolve(cwd, options.cache ?? "mangle-cache.json");
  const inputs = await resolveInputs(options.inputs ?? [], cwd);
  const outputs = resolveOutputs(inputs, cwd, options);
  const sourceCache = await readMangleCache(cachePath);
  const nameCache = toTerserNameCache(sourceCache);
  const pattern = normalizePattern(options.pattern ?? defaultPattern);
  const reserved = [...new Set(options.reserved ?? [])];
  const transformed: PendingWrite[] = [];

  for (const [index, input] of inputs.entries()) {
    const source = await readFile(input.path, "utf8");
    const content = await transformJavaScript({
      filePath: input.path,
      minify: options.minify ?? false,
      nameCache,
      pattern,
      reserved,
      source,
    });

    transformed.push({
      content,
      mode: await readMode(input.path),
      target: outputs[index],
    });
  }

  const cache = fromTerserNameCache(nameCache);
  transformed.push({
    content: serializeMangleCache(cache),
    mode: await readMode(cachePath),
    target: cachePath,
  });
  await writeBatch(transformed);

  return {
    cache,
    cachePath,
    files: inputs.map((input, index) => ({ input: input.path, output: outputs[index] })),
  };
}

function normalizePattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
}

function resolveOutputs(inputs: readonly ResolvedInput[], cwd: string, options: MangleOptions): string[] {
  if (options.outFile && options.outDir) throw new Error("outFile and outDir cannot be used together");

  if (options.outFile) {
    if (inputs.length !== 1) throw new Error("outFile requires exactly one input file");
    return [path.resolve(cwd, options.outFile)];
  }

  if (!options.outDir) return inputs.map((input) => input.path);

  const outDir = path.resolve(cwd, options.outDir);
  return inputs.map((input) => {
    const relativePath = path.relative(input.root, input.path);
    if (relativePath.startsWith(`..${path.sep}`)) {
      throw new Error(`Cannot preserve ${input.path} beneath output directory ${outDir}`);
    }
    return path.join(outDir, relativePath);
  });
}

export type { MangleCache } from "./cache";
