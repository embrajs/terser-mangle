import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type CliEnvironment, runCli } from "./cli-runner";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("terser-mangle CLI", () => {
  it("shows help without touching the working directory", async () => {
    const cwd = await createProject({});
    const io = createIo(cwd);

    const exitCode = await runCli(["--help"], io.environment);

    expect(exitCode).toBe(0);
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]).toContain("Usage: terser-mangle");
    expect(io.stderr).toEqual([]);
    await expect(readFile(path.join(cwd, "mangle-cache.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("processes dist in place and creates the project cache by default", async () => {
    const cwd = await createProject({
      "dist/a.js": "export const a = { value_: getValue() };\n",
      "dist/b.mjs": "export const b = { value_: getValue() };\n",
    });
    const io = createIo(cwd);

    const exitCode = await runCli([], io.environment);

    expect(exitCode).toBe(0);
    expect(io.stdout).toEqual(["Mangled 2 files."]);
    expect(io.stderr).toEqual([]);
    expect(await readFile(path.join(cwd, "dist/a.js"), "utf8")).not.toContain("value_");
    await expect(readJson(path.join(cwd, "mangle-cache.json"))).resolves.toHaveProperty("value_");
  });

  it("honors output, cache, reserve, and minify options", async () => {
    const source = `
      const longVariable = getObject();
      longVariable.keep_ = getValue();
      longVariable.alsoKeep_ = getOtherValue();
      longVariable.private_ = getPrivate();
      consume(longVariable.keep_, longVariable.alsoKeep_, longVariable.private_);
    `;
    const cwd = await createProject({ "build/input.js": source });
    const io = createIo(cwd);

    const exitCode = await runCli(
      [
        "build/input.js",
        "--out-file",
        "output.js",
        "--cache",
        "config/properties.json",
        "--reserve",
        "keep_",
        "--reserve",
        "alsoKeep_",
        "--minify",
      ],
      io.environment,
    );
    const output = await readFile(path.join(cwd, "output.js"), "utf8");

    expect(exitCode).toBe(0);
    expect(io.stdout).toEqual(["Mangled 1 file."]);
    expect(output.length).toBeLessThan(source.length / 2);
    expect(output).toContain("keep_");
    expect(output).toContain("alsoKeep_");
    expect(output).not.toContain("private_");
    await expect(readFile(path.join(cwd, "build/input.js"), "utf8")).resolves.toBe(source);
    const cache = (await readJson(path.join(cwd, "config/properties.json"))) as Record<string, string>;
    expect(cache).not.toHaveProperty("keep_");
    expect(cache).not.toHaveProperty("alsoKeep_");
  });

  it("writes globbed inputs beneath outDir without changing the sources", async () => {
    const source = "export const state = { value_: getValue() };\n";
    const cwd = await createProject({
      "build/nested/a.js": source,
      "build/root.mjs": source,
    });
    const io = createIo(cwd);

    const exitCode = await runCli(["build/**/*", "--out-dir", "output"], io.environment);

    expect(exitCode).toBe(0);
    expect(io.stdout).toEqual(["Mangled 2 files."]);
    await expect(readFile(path.join(cwd, "build/nested/a.js"), "utf8")).resolves.toBe(source);
    await expect(readFile(path.join(cwd, "output/nested/a.js"), "utf8")).resolves.not.toContain("value_");
    await expect(readFile(path.join(cwd, "output/root.mjs"), "utf8")).resolves.not.toContain("value_");
  });

  it("reports invalid arguments with a nonzero exit code", async () => {
    const cwd = await createProject({});
    const io = createIo(cwd);

    const exitCode = await runCli(["--unknown"], io.environment);

    expect(exitCode).toBe(1);
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toHaveLength(1);
    expect(io.stderr[0]).toMatch(/^terser-mangle: Unknown option/);
  });

  it("drops source map comments while transforming inputs", async () => {
    const source = "const item = { value_: 1 };\n//# sourceMappingURL=input.js.map\n";
    const cwd = await createProject({ "input.js": source });
    const io = createIo(cwd);

    const exitCode = await runCli(["input.js"], io.environment);

    expect(exitCode).toBe(0);
    expect(io.stdout).toEqual(["Mangled 1 file."]);
    expect(io.stderr).toEqual([]);
    await expect(readFile(path.join(cwd, "input.js"), "utf8")).resolves.not.toContain("sourceMappingURL");
    await expect(readJson(path.join(cwd, "mangle-cache.json"))).resolves.toHaveProperty("value_");
  });

  it("uses console output when no I/O handlers are provided", async () => {
    const cwd = await createProject({ "dist/index.js": "const item = { value_: getValue() };\n" });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runCli([], { cwd })).resolves.toBe(0);
    await expect(runCli(["--unknown"], { cwd })).resolves.toBe(1);

    expect(stdout).toHaveBeenCalledWith("Mangled 1 file.");
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^terser-mangle: Unknown option/));
  });

  it("formats non-Error failures from an output handler", async () => {
    const stderr: string[] = [];

    const exitCode = await runCli(["--help"], {
      stderr: (message) => stderr.push(message),
      stdout: () => {
        throw "output failed";
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["terser-mangle: output failed"]);
  });
});

function createIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const environment: CliEnvironment = {
    cwd,
    stderr: (message) => stderr.push(message),
    stdout: (message) => stdout.push(message),
  };

  return { environment, stderr, stdout };
}

async function createProject(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "terser-mangle-cli-"));
  temporaryDirectories.push(cwd);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(cwd, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return cwd;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}
