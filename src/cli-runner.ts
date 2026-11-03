import path from "node:path";
import { WriteStream } from "node:tty";
import { parseArgs } from "node:util";

import { mangle } from "./index";

const help = `Usage: terser-mangle [options] [files, directories, or globs...]

Deterministically mangle properties ending in a single underscore.

Options:
  -c, --cache <file>     Cache file (default: mangle-cache.json)
  -d, --out-dir <dir>    Write files beneath a directory
  -o, --out-file <file>  Write one input to a file
      --reserve <name>   Preserve a property name (repeatable)
      --minify           Also compress and mangle identifiers
  -q, --quiet            Only show the file count
  -h, --help             Show this help

With no inputs, terser-mangle recursively processes dist.
Inputs are changed in place unless an output option is provided.`;

export interface CliEnvironment {
  cwd?: string;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  environment: CliEnvironment = {},
): Promise<number> {
  const stdout = environment.stdout ?? console.log;
  const stderr = environment.stderr ?? console.error;

  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args: [...args],
      options: {
        cache: { short: "c", type: "string" },
        help: { short: "h", type: "boolean" },
        minify: { type: "boolean" },
        "out-dir": { short: "d", type: "string" },
        "out-file": { short: "o", type: "string" },
        quiet: { short: "q", type: "boolean" },
        reserve: { multiple: true, type: "string" },
      },
      strict: true,
    });

    if (values.help) {
      stdout(help);
      return 0;
    }

    const cwd = path.resolve(environment.cwd ?? process.cwd());
    const result = await mangle({
      cache: values.cache,
      cwd,
      inputs: positionals,
      minify: values.minify,
      outDir: values["out-dir"],
      outFile: values["out-file"],
      reserved: values.reserve,
    });

    if (values.quiet) {
      stdout(`Mangled ${result.files.length} file${result.files.length === 1 ? "" : "s"}.`);
    } else {
      const prefix = WriteStream.prototype.hasColors() ? "\u001b[90mmangled\u001b[39m" : "mangled";
      for (const file of result.files) stdout(`${prefix} ${path.relative(cwd, file.output)}`);
    }
    return 0;
  } catch (error) {
    stderr(`terser-mangle: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
