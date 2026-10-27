/**
 * Generate Zeus TypeScript types from a GraphQL schema.
 *
 * Usage (file):  tsx scripts/zeus-gen.ts <schema.graphql> <output-dir>
 * Usage (URL):   tsx scripts/zeus-gen.ts <https://endpoint> <output-dir> [--graphql=schema.graphql] [--header=Key:Value] [--method=GET|POST]
 *
 * Examples:
 *   tsx scripts/zeus-gen.ts graphql/kitsu.schema.graphql src/lib/zeus/kitsu
 *   tsx scripts/zeus-gen.ts https://kitsu.app/api/graphql src/lib/zeus/kitsu --graphql=graphql/kitsu.schema.graphql
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));

const [input, outputDir] = positionals;
const graphqlFlag = flags.find((f) => f.startsWith("--graphql="));
const schemaOutputFile = graphqlFlag?.slice("--graphql=".length);
const headerFlags = flags
  .filter((f) => f.startsWith("--header="))
  .map((f) => f.slice("--header=".length));
const methodFlag = flags
  .find((f) => f.startsWith("--method="))
  ?.slice("--method=".length);

if (!input || !outputDir) {
  console.error("Usage:");
  console.error(
    "  From file: tsx scripts/zeus-gen.ts <schema.graphql> <output-dir>",
  );
  console.error(
    "  From URL:  tsx scripts/zeus-gen.ts <https://endpoint> <output-dir> [--graphql=schema.graphql] [--header=Key:Value] [--method=GET|POST]",
  );
  process.exit(1);
}

// Resolve graphql-zeus and graphql-zeus-core relative to the project.
// graphql-zeus-core is a dep of graphql-zeus, so we locate it via zeus's own
// require context to get the correct pnpm-virtualised path.
const projectRequire = createRequire(path.join(process.cwd(), "package.json"));
const zeusEntry = projectRequire.resolve("graphql-zeus");
// zeusEntry = .../node_modules/.pnpm/.../graphql-zeus/lib/index.js
const zeusPkgDir = path.dirname(path.dirname(zeusEntry));
// zeusPkgDir = .../node_modules/.pnpm/.../graphql-zeus

const zeusRequire = createRequire(path.join(zeusPkgDir, "package.json"));
const zeusCoreEntry = zeusRequire.resolve("graphql-zeus-core");
// zeusCoreEntry = .../node_modules/.pnpm/.../graphql-zeus-core/lib/index.js

const { Utils } = (await import(
  path.join(zeusPkgDir, "lib/Utils/index.js")
)) as {
  Utils: {
    getFromUrl: (
      url: string,
      opts: { header?: string[]; method?: string },
    ) => Promise<string>;
  };
};

const { TranslateGraphQL } = (await import(zeusCoreEntry)) as {
  TranslateGraphQL: {
    typescriptSplit: (opts: {
      schema: string;
      env: string;
      esModule: boolean;
      deno: boolean;
      constEnums: boolean;
      subscriptions: string;
    }) => Record<string, string>;
  };
};

// ------------------------------------------------------------------
// Load schema — from URL (introspection) or local file
// ------------------------------------------------------------------

let schemaContent: string;
const isUrl = input.startsWith("http://") || input.startsWith("https://");

if (isUrl) {
  console.log(`Introspecting schema from ${input} …`);
  schemaContent = await Utils.getFromUrl(input, {
    header: headerFlags,
    method: methodFlag,
  });

  if (schemaOutputFile) {
    const dir = path.dirname(schemaOutputFile);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(schemaOutputFile, schemaContent);
    console.log(`Saved schema  → ${schemaOutputFile}`);
  }
} else {
  schemaContent = fs.readFileSync(input, "utf8");
}

// ------------------------------------------------------------------
// Generate TypeScript types
// ------------------------------------------------------------------

const result = TranslateGraphQL.typescriptSplit({
  schema: schemaContent,
  env: "node",
  esModule: true,
  deno: false,
  constEnums: false,
  subscriptions: "legacy",
});

fs.mkdirSync(outputDir, { recursive: true });
for (const [name, content] of Object.entries(result)) {
  const dest = path.join(outputDir, `${name}.ts`);
  // Strip .js extensions from relative imports so Turbopack/Next.js resolves .ts files correctly
  const fixed = content.replace(/from '(\.[^']+)\.js'/g, "from '$1'");
  fs.writeFileSync(dest, fixed);
  console.log(`Wrote         → ${dest}`);
}
