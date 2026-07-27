import { defineConfig, type UserConfig } from "tsdown";

const sharedConfig = {
  clean: true,
  format: ["cjs", "esm"],
  minify: Boolean(process.env.MINIFY),
  outputOptions: {
    codeSplitting: false,
  },
  sourcemap: false,
  target: "esnext",
  treeshake: false,
} satisfies UserConfig;

export default defineConfig([
  {
    ...sharedConfig,
    dts: true,
    entry: {
      index: "src/index.ts",
    },
  },
  {
    ...sharedConfig,
    dts: false,
    entry: {
      cli: "src/cli.ts",
    },
  },
]);
