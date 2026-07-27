# @embra/terser-mangle

[![Docs](https://img.shields.io/badge/Docs-read-%23fdf9f5)](https://embrajs.github.io/terser-mangle)
[![Build Status](https://github.com/embrajs/terser-mangle/actions/workflows/build.yml/badge.svg)](https://github.com/embrajs/terser-mangle/actions/workflows/build.yml)
[![npm-version](https://img.shields.io/npm/v/@embra/terser-mangle.svg)](https://www.npmjs.com/package/@embra/terser-mangle)
[![Coverage Status](https://embrajs.github.io/terser-mangle/coverage-badges/@embra/terser-mangle.svg)](https://embrajs.github.io/terser-mangle/coverage/)
[![minified-size](https://img.shields.io/bundlephobia/minzip/@embra/terser-mangle)](https://bundlephobia.com/package/@embra/terser-mangle)

terser-mangle

## Install

```
npm add @embra/terser-mangle
```

## Development

### Publish New Version

You can use [npm version](https://docs.npmjs.com/cli/v10/commands/npm-version) to bump version.

```
npm version patch
```

Push the tag to remote and CI will publish the new version to npm.

```
git push --follow-tags
```

### CI Auto Publish

If you want to publish the package in CI, you need to enable [trusted publishing](https://docs.npmjs.com/trusted-publishers) in npmjs.com. However, the [settings page](https://www.npmjs.com/package/@embra/terser-mangle/access) is only visible when the package already exists. So you will have to publish the package manually for the first time.

## License

MIT @ [embrajs](https://github.com/embrajs)
