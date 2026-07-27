import path from "node:path";
import { minify } from "terser";

const identifierPattern = /[$_\p{ID_Start}](?:[$_\p{ID_Continue}]|\u200C|\u200D)*/gu;

export interface TransformOptions {
  filePath: string;
  minify: boolean;
  nameCache: object;
  pattern: RegExp;
  reserved: readonly string[];
  source: string;
}

export async function transformJavaScript(options: TransformOptions): Promise<string> {
  const { filePath, nameCache, pattern, reserved, source } = options;

  const shouldMinify = options.minify;
  const result = await minify(
    {
      [path.basename(filePath)]: source,
    },
    {
      compress: shouldMinify,
      format: {
        beautify: !shouldMinify,
        comments: "some",
        preserve_annotations: true,
        shebang: true,
      },
      mangle: {
        ...(shouldMinify ? undefined : { reserved: collectIdentifiers(source) }),
        properties: {
          regex: pattern,
          reserved: [...reserved],
        },
        toplevel: shouldMinify,
      },
      module: filePath.toLowerCase().endsWith(".mjs"),
      nameCache,
      toplevel: shouldMinify,
    },
  );

  const code = result.code as string;
  return `${code}\n`;
}

function collectIdentifiers(source: string): string[] {
  return [...new Set(source.match(identifierPattern) ?? [])];
}
