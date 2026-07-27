import { stat } from "node:fs/promises";
import path from "node:path";
import { glob, isDynamicPattern } from "tinyglobby";

const javaScriptFilePattern = /\.(?:cjs|js|mjs)$/i;

export interface ResolvedInput {
  path: string;
  root: string;
}

export async function resolveInputs(patterns: readonly string[], cwd: string): Promise<ResolvedInput[]> {
  const inputs = patterns.length ? patterns : ["dist"];
  const resolved = new Map<string, ResolvedInput>();

  for (const input of inputs) {
    if (!input) throw new Error("Input paths and patterns cannot be empty");
    if (input.startsWith("!")) throw new Error(`Negated input patterns are not supported: ${input}`);

    const literalPath = path.resolve(cwd, input);
    const fileStat = await tryStat(literalPath);

    if (fileStat?.isFile()) {
      if (!javaScriptFilePattern.test(literalPath)) {
        throw new Error(`Unsupported input file extension: ${input}`);
      }
      resolved.set(literalPath, { path: literalPath, root: cwd });
      continue;
    }

    let matches: string[];
    let root: string;

    if (fileStat?.isDirectory()) {
      matches = await glob("**/*", {
        absolute: true,
        cwd: literalPath,
        dot: true,
        followSymbolicLinks: false,
        onlyFiles: true,
      });
      root = literalPath;
    } else {
      matches = await glob(input, {
        absolute: true,
        cwd,
        dot: true,
        expandDirectories: true,
        followSymbolicLinks: false,
        onlyFiles: true,
      });
      root = findGlobRoot(input, cwd);
    }

    const javaScriptMatches = matches.filter((file) => javaScriptFilePattern.test(file));
    if (!javaScriptMatches.length) {
      throw new Error(`Input did not match any JavaScript files: ${input}`);
    }

    for (const file of javaScriptMatches) {
      const absolutePath = path.resolve(file);
      if (!resolved.has(absolutePath)) resolved.set(absolutePath, { path: absolutePath, root });
    }
  }

  return [...resolved.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function findGlobRoot(pattern: string, cwd: string): string {
  const absolutePattern = path.resolve(cwd, pattern);
  const parsed = path.parse(absolutePattern);
  let root = parsed.root;

  for (const segment of absolutePattern.slice(parsed.root.length).split(path.sep)) {
    if (isDynamicPattern(segment, { caseSensitiveMatch: process.platform !== "win32" })) break;
    root = path.join(root, segment);
  }

  return root;
}

async function tryStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
