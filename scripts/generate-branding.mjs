import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Use the image runtime shipped with the pinned Next.js dependency.
const nextRequire = createRequire(path.join(root, "apps/anime/package.json"));
const sharp = createRequire(nextRequire.resolve("next/package.json"))("sharp");
const deviceSource = await fs.readFile(
  path.join(root, "packages/ui/src/pwa-devices.ts"),
  "utf8",
);
const devices = [...deviceSource.matchAll(/\[(\d+),\s*(\d+),\s*(\d+)\]/g)].map(
  (m) => m.slice(1).map(Number),
);
const apps = ["anime", "books", "movies"];
const png = { compressionLevel: 9, adaptiveFiltering: true };
const svgBuffer = (source) => Buffer.from(source);

// PNG-backed ICO entries keep the fallback small while supplying native tab sizes.
async function faviconIco(source) {
  const sizes = [16, 32, 48];
  const images = await Promise.all(
    sizes.map((s) => sharp(source).resize(s, s).png(png).toBuffer()),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const start = 6 + i * 16;
    header[start] = sizes[i];
    header[start + 1] = sizes[i];
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(image.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

function maskable(source, size) {
  // The complete circular mark fits inside 76% of the canvas diameter, beneath
  // the 80% maskable safe circle. Corners are opaque and left for the OS to mask.
  const inner = source
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<svg\b/, '<svg x="120" y="120" width="760" height="760"');
  return svgBuffer(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#825aff"/>${inner}</svg>`,
  );
}

function splashLayers(source) {
  const match = source.match(
    /<rect\b[^>]*\bwidth="[\d.]+"[^>]*\bheight="[\d.]+"[^>]*\/>/,
  );
  if (!match) throw new Error("Missing full-bleed splash background");
  const body = source.replace(match[0], "");
  const gradient = source.match(
    /<linearGradient\b[^>]*>[\s\S]*?<\/linearGradient>/,
  )[0];
  const colors = [...gradient.matchAll(/stop-color="([^"]+)"/g)].map(
    (m) => m[1],
  );
  return { body, colors };
}

const foregroundCache = new Map();
async function startup(source, width, height) {
  const { body, colors } = splashLayers(source);
  // Trim transparent margins around the artwork before fitting it to each screen.
  // This preserves the Avayx lettering and symbol without cropping either one.
  if (!foregroundCache.has(source))
    foregroundCache.set(
      source,
      await sharp(svgBuffer(body), { density: 216 }).trim().toBuffer(),
    );
  const foreground = foregroundCache.get(source);
  const graphic = await sharp(foreground)
    .resize(Math.round(width * 0.82), Math.round(height * 0.72), {
      fit: "inside",
    })
    .png()
    .toBuffer();
  const background = svgBuffer(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="bg"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors.at(-1)}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/></svg>`,
  );
  return sharp(background)
    .composite([{ input: graphic, gravity: "centre" }])
    .removeAlpha()
    .png(png)
    .toBuffer();
}

for (const app of apps) {
  const sourceDir = path.join(root, "branding", app);
  const output = path.join(root, "apps", app, "public/icons/tsuki");
  await fs.mkdir(path.join(output, "startup"), { recursive: true });
  const read = (kind) => fs.readFile(path.join(sourceDir, `${kind}.svg`));
  const favicon = await read("favicon"),
    touch = await read("touch");
  await fs.writeFile(path.join(output, "favicon.svg"), favicon);
  await fs.copyFile(
    path.join(sourceDir, "squircle.svg"),
    path.join(output, "squirlecon.svg"),
  );
  await fs.writeFile(
    path.join(root, "apps", app, "src/app/favicon.ico"),
    await faviconIco(favicon),
  );
  for (const size of [192, 512])
    await sharp(touch)
      .resize(size, size)
      .removeAlpha()
      .png(png)
      .toFile(path.join(output, `pwa-${size}.png`));
  await sharp(touch)
    .resize(180, 180)
    .removeAlpha()
    .png(png)
    .toFile(path.join(output, "apple-touch-icon.png"));
  for (const size of [512, 1024])
    await sharp(maskable(favicon.toString(), size))
      .removeAlpha()
      .png(png)
      .toFile(path.join(output, `maskable-${size}.png`));
  for (const [kind, filename] of [
    ["og", "open-graph"],
    ["twitter", "twitter"],
  ])
    await sharp(await read(kind))
      .removeAlpha()
      .png(png)
      .toFile(path.join(output, `${filename}.png`));
  const portrait = (await read("portrait")).toString(),
    landscape = (await read("landscape")).toString(),
    square = (await read("square")).toString();
  const seen = new Set();
  for (const [w, h, ratio] of devices)
    for (const [width, height] of [
      [w * ratio, h * ratio],
      [h * ratio, w * ratio],
    ]) {
      const filename = `${width}x${height}.png`;
      if (seen.has(filename)) continue;
      seen.add(filename);
      const source =
        width > height ? landscape : height / width > 1.7 ? portrait : square;
      await fs.writeFile(
        path.join(output, "startup", filename),
        await startup(source, width, height),
      );
    }
  console.log(
    `${app}: icons, social cards, ${seen.size} exact-size Apple startup images`,
  );
}
