# @embra/terser-mangle

[![Build Status](https://github.com/embrajs/terser-mangle/actions/workflows/build.yml/badge.svg)](https://github.com/embrajs/terser-mangle/actions/workflows/build.yml)
[![NPM Version](https://img.shields.io/npm/v/@embra/terser-mangle.svg)](https://www.npmjs.com/package/@embra/terser-mangle)
[![Coverage Status](https://embrajs.github.io/terser-mangle/coverage-badges/@embra/terser-mangle.svg)](https://embrajs.github.io/terser-mangle/coverage/)

Deterministic property mangling for JavaScript build output. Each consuming project owns a flat, committable
`mangle-cache.json` so property names remain stable across builds.

By default, properties ending in a single underscore are mangled. `value_` is eligible while `value__` is not.

## Why

Rolldown and its Oxc Minifier currently do not support cached property mangling. This package post-processes Rolldown
output with Terser and stores stable mappings in the consuming project's `mangle-cache.json`.

## Install

```sh
npm add -D @embra/terser-mangle
```

`terser` and the cross-platform glob implementation are included as runtime dependencies.

Node.js 20 or newer is required.

## CLI

Run the command after the project build. For compact output, leave Rolldown minification disabled and use `--minify`:

```json
{
  "scripts": {
    "build": "tsdown && terser-mangle",
    "build:min": "tsdown && terser-mangle --minify"
  }
}
```

With no inputs, the command recursively processes JavaScript files in `dist` and writes them in place:

```sh
terser-mangle
terser-mangle dist
terser-mangle "dist/**/*.{js,mjs,cjs}"
terser-mangle dist/index.js dist/index.mjs
```

Inputs are resolved together, deduplicated, sorted, and transformed with one shared cache. The cache and outputs are
written only after every input has been transformed successfully.

### Output

In-place processing is the default. Use `--out-file` with exactly one input, or `--out-dir` to preserve the input
directory structure beneath another directory:

```sh
terser-mangle input.js --out-file output.js
terser-mangle dist --out-dir mangled
terser-mangle "dist/**/*" --out-dir mangled
```

### Minification

`--minify` adds Terser compression, normal identifier mangling, top-level mangling, and compact output:

```sh
terser-mangle dist --minify
```

Without `--minify`, normal identifiers remain unchanged and Terser emits readable output.

### Options

```text
-c, --cache <file>     Cache file (default: mangle-cache.json)
-d, --out-dir <dir>    Write files beneath a directory
-o, --out-file <file>  Write one input to a file
    --reserve <name>   Preserve a property name (repeatable)
    --minify           Also compress and mangle identifiers
-h, --help             Show help
```

The CLI intentionally fixes the property pattern to `/[^_]_$/`. Use the API when another convention is required.

## API

```ts
import { mangle } from "@embra/terser-mangle";

const result = await mangle({
  inputs: ["dist/**/*.{js,mjs,cjs}"],
  cache: "mangle-cache.json",
  outDir: "mangled",
  reserved: ["external_"],
});

console.log(result.files);
console.log(result.cache);
```

Relative inputs, cache paths, and outputs are resolved from `cwd`, which defaults to `process.cwd()`.

A custom property convention is available through the API:

```ts
await mangle({
  inputs: ["dist"],
  pattern: /^private_/,
});
```

## Cache

The cache is a plain JSON object:

```json
{
  "value_": "v",
  "version_": "i"
}
```

Commit this file with the consuming project. Deleting or manually changing entries can change the property ABI of
published output.

The format can also be passed directly to esbuild or tsup:

```ts
import { defineConfig } from "tsup";
import mangleCache from "./mangle-cache.json";

export default defineConfig({
  esbuildOptions(options) {
    options.mangleProps = /[^_]_$/;
    options.mangleCache = mangleCache;
  },
});
```

Projects that exchange underscore-suffixed properties at runtime must explicitly use the same cache. Otherwise, keep
the cache local to each project.

## Source Maps

Source map composition is not supported. Existing `sourceMappingURL` comments are removed from transformed output.
Disable source maps for the mangled build or run a source-map-aware transform elsewhere.

Content-hashed filenames and manifests are treated as ordinary files and are not recalculated.

## License

MIT © [embrajs](https://github.com/embrajs)
