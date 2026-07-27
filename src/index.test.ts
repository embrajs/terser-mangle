import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mangle } from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("mangle", () => {
  it("mangles properties in place with a stable consumer-owned cache", async () => {
    const cwd = await createProject({
      "dist/a.js": "const longVariable = { value_: 1, public__: 2 }; console.log(longVariable.value_);\n",
      "dist/b.mjs": "export const otherVariable = { value_: 3 };\n",
      "mangle-cache.json": '{"value_":"v"}\n',
    });

    const result = await mangle({ cwd, inputs: ["dist"] });
    const a = await readFile(path.join(cwd, "dist/a.js"), "utf8");
    const b = await readFile(path.join(cwd, "dist/b.mjs"), "utf8");

    expect(result.files).toHaveLength(2);
    expect(a).toContain("longVariable");
    expect(a).toContain("public__: 2");
    expect(a).toContain("longVariable.v");
    expect(b).toContain("otherVariable");
    expect(b).toContain("v: 3");
    await expect(readJson(path.join(cwd, "mangle-cache.json"))).resolves.toEqual({ value_: "v" });
  });

  it("keeps existing mappings and assigns new properties across builds", async () => {
    const cwd = await createProject({
      "dist/index.js": "export const first = { first_: getFirst() };\n",
    });

    await mangle({ cwd });
    const firstCache = (await readJson(path.join(cwd, "mangle-cache.json"))) as Record<string, string>;
    await writeProjectFile(
      cwd,
      "dist/index.js",
      "export const values = { first_: getFirst(), second_: getSecond() };\n",
    );

    await mangle({ cwd });
    const secondCache = (await readJson(path.join(cwd, "mangle-cache.json"))) as Record<string, string>;

    expect(secondCache.first_).toBe(firstCache.first_);
    expect(secondCache.second_).toEqual(expect.any(String));
    expect(secondCache.second_).not.toBe(secondCache.first_);
  });

  it("produces deterministic mappings regardless of input order", async () => {
    const files = {
      "dist/a.js": "export const a = { alpha_: getAlpha() };\n",
      "dist/b.js": "export const b = { beta_: getBeta() };\n",
    };
    const firstProject = await createProject(files);
    const secondProject = await createProject(files);

    const first = await mangle({ cwd: firstProject, inputs: ["dist/b.js", "dist/a.js"] });
    const second = await mangle({ cwd: secondProject, inputs: ["dist/a.js", "dist/b.js"] });

    expect(first.cache).toEqual(second.cache);
    await expect(readFile(path.join(firstProject, "dist/a.js"), "utf8")).resolves.toBe(
      await readFile(path.join(secondProject, "dist/a.js"), "utf8"),
    );
    await expect(readFile(path.join(firstProject, "dist/b.js"), "utf8")).resolves.toBe(
      await readFile(path.join(secondProject, "dist/b.js"), "utf8"),
    );
  });

  it("resolves globs once and writes their relative structure beneath outDir", async () => {
    const source = "export const state = { value_: 1 };\n";
    const cwd = await createProject({
      "build/nested/a.js": source,
      "build/nested/ignored.css": ".value_ {}\n",
      "build/root.mjs": source,
    });

    const result = await mangle({ cwd, inputs: ["build", "build/**/*"], outDir: "output" });

    expect(result.files.map((file) => path.relative(cwd, file.output))).toEqual([
      "output/nested/a.js",
      "output/root.mjs",
    ]);
    await expect(readFile(path.join(cwd, "build/nested/a.js"), "utf8")).resolves.toBe(source);
    await expect(readFile(path.join(cwd, "output/nested/a.js"), "utf8")).resolves.not.toBe(source);
  });

  it("writes one input to outFile without changing the input", async () => {
    const source = "const item = { value_: 1 };\n";
    const cwd = await createProject({ "input.js": source });

    await mangle({ cwd, inputs: ["input.js"], outFile: "output.js" });

    await expect(readFile(path.join(cwd, "input.js"), "utf8")).resolves.toBe(source);
    await expect(readFile(path.join(cwd, "output.js"), "utf8")).resolves.not.toBe(source);
  });

  it("resolves absolute paths from the process cwd when cwd is omitted", async () => {
    const cwd = await createProject({ "input.js": "const item = { value_: getValue() };\n" });
    const input = path.join(cwd, "input.js");
    const output = path.join(cwd, "output.js");
    const cache = path.join(cwd, "properties.json");

    const result = await mangle({ cache, inputs: [input], outFile: output });

    expect(result.files).toEqual([{ input, output }]);
    await expect(readJson(cache)).resolves.toHaveProperty("value_");
  });

  it("accepts empty JavaScript files", async () => {
    const cwd = await createProject({ "empty.js": "" });

    await mangle({ cwd, inputs: ["empty.js"] });

    await expect(readFile(path.join(cwd, "empty.js"), "utf8")).resolves.toBe("\n");
    await expect(readJson(path.join(cwd, "mangle-cache.json"))).resolves.toEqual({});
  });

  it("supports custom API patterns and reserved properties", async () => {
    const cwd = await createProject({
      "input.js": "const item = { internal: 1, keep: 2 }; console.log(item.internal, item.keep);\n",
    });

    const result = await mangle({
      cwd,
      inputs: ["input.js"],
      pattern: /^(?:internal|keep)$/,
      reserved: ["keep"],
    });
    const output = await readFile(path.join(cwd, "input.js"), "utf8");

    expect(output).toContain("item.keep");
    expect(output).not.toContain("item.internal");
    expect(result.cache).toHaveProperty("internal");
    expect(result.cache).not.toHaveProperty("keep");
  });

  it.each([/[^_]_$/g, /[^_]_$/y])("removes stateful flags from custom patterns", async (pattern) => {
    const cwd = await createProject({
      "input.js": "const item = { alpha_: 1, beta_: 2 }; console.log(item.alpha_, item.beta_);\n",
    });

    const result = await mangle({ cwd, inputs: ["input.js"], pattern });
    const output = await readFile(path.join(cwd, "input.js"), "utf8");

    expect(output).not.toContain("alpha_");
    expect(output).not.toContain("beta_");
    expect(result.cache).toHaveProperty("alpha_");
    expect(result.cache).toHaveProperty("beta_");
  });

  it("uses the fixed full-minify preset", async () => {
    const source = `
      function createLongObjectName() {
        const unnecessaryLocalVariable = { privateValue_: 1 };
        return unnecessaryLocalVariable.privateValue_;
      }
      console.log(createLongObjectName());
    `;
    const cwd = await createProject({ "input.js": source });

    await mangle({ cwd, inputs: ["input.js"], minify: true });
    const output = await readFile(path.join(cwd, "input.js"), "utf8");

    expect(output.length).toBeLessThan(source.length / 2);
    expect(output).not.toContain("unnecessaryLocalVariable");
    expect(output).not.toContain("privateValue_");
  });

  it("does not mangle Unicode identifiers in property-only mode", async () => {
    const cwd = await createProject({
      "input.js": "const 数据 = { value_: 1 }; console.log(数据.value_);\n",
    });

    await mangle({ cwd, inputs: ["input.js"] });

    await expect(readFile(path.join(cwd, "input.js"), "utf8")).resolves.toContain("数据");
  });

  it("preserves shebangs, legal comments, and pure annotations", async () => {
    const cwd = await createProject({
      "bin.js": "#!/usr/bin/env node\n/*! License */\nconst value = /* @__PURE__ */ factory({ value_: 1 });\n",
    });

    await mangle({ cwd, inputs: ["bin.js"] });
    const output = await readFile(path.join(cwd, "bin.js"), "utf8");

    expect(output).toMatch(/^#!\/usr\/bin\/env node/);
    expect(output).toContain("/*! License */");
    expect(output).toContain("/* @__PURE__ */");
  });

  it("drops source map comments while transforming files", async () => {
    const original = "const item = { value_: 1 };\n";
    const mapped = `${original}//# sourceMappingURL=mapped.js.map\n`;
    const cwd = await createProject({
      "dist/a.js": original,
      "dist/b.js": mapped,
      "dist/c.js": 'const marker = "/*# sourceMappingURL=fake.map */";\n',
      "mangle-cache.json": "{}\n",
    });

    await mangle({ cwd, inputs: ["dist"] });

    await expect(readFile(path.join(cwd, "dist/a.js"), "utf8")).resolves.not.toContain("value_");
    await expect(readFile(path.join(cwd, "dist/b.js"), "utf8")).resolves.not.toContain("sourceMappingURL");
    await expect(readFile(path.join(cwd, "dist/c.js"), "utf8")).resolves.toContain("sourceMappingURL=fake.map");
    await expect(readJson(path.join(cwd, "mangle-cache.json"))).resolves.toHaveProperty("value_");
  });

  it("does not write earlier files when a later input has invalid JavaScript", async () => {
    const valid = "const item = { value_: getValue() };\n";
    const invalid = "const broken = { value_: ;\n";
    const cwd = await createProject({
      "dist/a.js": valid,
      "dist/z.js": invalid,
      "mangle-cache.json": "{}\n",
    });

    await expect(mangle({ cwd, inputs: ["dist"] })).rejects.toThrow();
    await expect(readFile(path.join(cwd, "dist/a.js"), "utf8")).resolves.toBe(valid);
    await expect(readFile(path.join(cwd, "dist/z.js"), "utf8")).resolves.toBe(invalid);
    await expect(readFile(path.join(cwd, "mangle-cache.json"), "utf8")).resolves.toBe("{}\n");
  });

  it("rejects colliding directory outputs without writing files or cache", async () => {
    const cwd = await createProject({
      "first/index.js": "export const first = { first_: getFirst() };\n",
      "second/index.js": "export const second = { second_: getSecond() };\n",
    });

    await expect(mangle({ cwd, inputs: ["first", "second"], outDir: "output" })).rejects.toThrow(
      "Multiple outputs resolve to",
    );
    await expect(readFile(path.join(cwd, "mangle-cache.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(cwd, "output/index.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an output path that would escape outDir", async () => {
    const root = await createProject({
      "outside.js": "export const value = { value_: getValue() };\n",
      "project/.keep": "",
    });
    const cwd = path.join(root, "project");

    await expect(mangle({ cwd, inputs: ["../outside.js"], outDir: "output" })).rejects.toThrow("Cannot preserve");
  });

  it("cleans staged files when an output cannot be replaced", async () => {
    const source = "const item = { value_: getValue() };\n";
    const cwd = await createProject({ "input.js": source });
    await mkdir(path.join(cwd, "output.js"));

    await expect(mangle({ cwd, inputs: ["input.js"], outFile: "output.js" })).rejects.toThrow();
    await expect(readFile(path.join(cwd, "input.js"), "utf8")).resolves.toBe(source);
    await expect(readFile(path.join(cwd, "mangle-cache.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(cwd)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it.each([
    ["invalid JSON", "{", "Could not parse cache file"],
    ["an array", "[]", "must contain a JSON object"],
    ["a non-string mapping", '{"value_":1}', "must map to a non-empty string"],
    ["an empty mapping", '{"value_":""}', "must map to a non-empty string"],
  ])("rejects a cache containing %s", async (_description, cache, message) => {
    const source = "const item = { value_: getValue() };\n";
    const cwd = await createProject({ "input.js": source, "mangle-cache.json": cache });

    await expect(mangle({ cwd, inputs: ["input.js"] })).rejects.toThrow(message);
    await expect(readFile(path.join(cwd, "input.js"), "utf8")).resolves.toBe(source);
  });

  it("forwards cache read errors other than a missing file", async () => {
    const cwd = await createProject({ "input.js": "const item = { value_: getValue() };\n" });
    await mkdir(path.join(cwd, "cache-directory"));

    await expect(mangle({ cache: "cache-directory", cwd, inputs: ["input.js"] })).rejects.toThrow();
  });

  it.each([
    [[""], "Input paths and patterns cannot be empty"],
    [["!dist/**/*.js"], "Negated input patterns are not supported"],
    [["missing/**/*.js"], "did not match any JavaScript files"],
  ])("rejects invalid input %j", async (inputs, message) => {
    const cwd = await createProject({});

    await expect(mangle({ cwd, inputs })).rejects.toThrow(message);
  });

  it("rejects explicitly unsupported file extensions", async () => {
    const cwd = await createProject({ "styles.css": ".value_ {}\n" });

    await expect(mangle({ cwd, inputs: ["styles.css"] })).rejects.toThrow("Unsupported input file extension");
  });

  it("forwards path errors encountered while resolving a literal input", async () => {
    const cwd = await createProject({ blocked: "not a directory\n" });

    await expect(mangle({ cwd, inputs: ["blocked/input.js"] })).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("rejects ambiguous output and invalid cache mappings", async () => {
    const cwd = await createProject({
      "a.js": "const a = { value_: 1 };\n",
      "b.js": "const b = { value_: 2 };\n",
      "mangle-cache.json": '{"first_":"x","second_":"x"}\n',
    });

    await expect(mangle({ cwd, inputs: ["a.js", "b.js"], outFile: "output.js" })).rejects.toThrow(
      "outFile requires exactly one input file",
    );
    await expect(mangle({ cwd, inputs: ["a.js"], outDir: "output", outFile: "output.js" })).rejects.toThrow(
      "outFile and outDir cannot be used together",
    );
    await expect(mangle({ cwd, inputs: ["a.js"] })).rejects.toThrow("both map to");
  });
});

async function createProject(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "terser-mangle-"));
  temporaryDirectories.push(cwd);

  for (const [relativePath, content] of Object.entries(files)) {
    await writeProjectFile(cwd, relativePath, content);
  }

  return cwd;
}

async function writeProjectFile(cwd: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}
