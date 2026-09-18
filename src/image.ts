import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { VrefError } from "./errors.js";
import type { VrefViewport } from "./types.js";

export const WEBP_EXTENSION = ".webp";

const SOURCE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export type EncodeWebpOptions = {
  sourcePath: string;
  quality?: number;
};

export type EncodedImage = {
  data: Buffer;
  width: number;
  height: number;
  reencoded: boolean;
};

export function isWebpFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === WEBP_EXTENSION;
}

export function webpSiblingPath(filePath: string): string {
  const extension = extname(filePath);

  return extension.length === 0
    ? `${filePath}${WEBP_EXTENSION}`
    : `${filePath.slice(0, -extension.length)}${WEBP_EXTENSION}`;
}

export function assertSupportedSource(sourcePath: string): void {
  const extension = extname(sourcePath).toLowerCase();

  if (!SOURCE_EXTENSIONS.includes(extension)) {
    throw new VrefError(
      "VREF_UNSUPPORTED_SOURCE_IMAGE",
      `source image must be ${SOURCE_EXTENSIONS.join(", ")}: ${sourcePath}`,
    );
  }
}

/**
 * Encode a captured screenshot to webp.
 *
 * Lossless is the default because these files are pixel evidence, not gallery
 * decoration: on flat UI captures lossless webp is smaller than lossy q85 and
 * leaves text edges and 1px borders exact. `quality` opts into lossy for the
 * photo-heavy captures where that trade pays off.
 */
export async function encodeWebp(options: EncodeWebpOptions): Promise<EncodedImage> {
  assertSupportedSource(options.sourcePath);
  assertQuality(options.quality);

  const sharp = await loadSharp();
  const source = await readSource(options.sourcePath);

  // A webp source is already in the target format, so re-encoding it would cost
  // fidelity for nothing. Copy it verbatim unless an explicit quality asks for
  // a re-encode.
  if (isWebpFile(options.sourcePath) && options.quality === undefined) {
    const metadata = await readMetadata(sharp, source, options.sourcePath);

    return { data: source, width: metadata.width, height: metadata.height, reencoded: false };
  }

  const encodeOptions =
    options.quality === undefined ? { lossless: true } : { quality: options.quality };

  try {
    // `rotate()` with no angle applies the source's EXIF orientation. Encoding
    // drops that tag, so without this a portrait capture would be stored
    // sideways. Dimensions come from the encoder for the same reason: they must
    // describe the rotated result, not the stored pixel order.
    const { data, info } = await sharp(source)
      .rotate()
      .webp(encodeOptions)
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height, reencoded: true };
  } catch (error) {
    throw new VrefError(
      "VREF_IMAGE_ENCODE_FAILED",
      `could not encode ${options.sourcePath} to webp: ${messageFrom(error)}`,
    );
  }
}

type SharpModule = typeof import("sharp").default;

async function loadSharp(): Promise<SharpModule> {
  try {
    const module = await import("sharp");

    return module.default;
  } catch (error) {
    throw new VrefError(
      "VREF_ENCODER_UNAVAILABLE",
      `sharp could not be loaded for webp encoding: ${messageFrom(error)}`,
    );
  }
}

async function readSource(sourcePath: string): Promise<Buffer> {
  try {
    return await readFile(sourcePath);
  } catch (error) {
    throw new VrefError(
      "VREF_IMAGE_READ_FAILED",
      `could not read source image ${sourcePath}: ${messageFrom(error)}`,
    );
  }
}

async function readMetadata(
  sharp: SharpModule,
  source: Buffer,
  sourcePath: string,
): Promise<VrefViewport> {
  let width: number | undefined;
  let height: number | undefined;

  try {
    const metadata = await sharp(source).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch (error) {
    throw new VrefError(
      "VREF_IMAGE_READ_FAILED",
      `could not read image metadata for ${sourcePath}: ${messageFrom(error)}`,
    );
  }

  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    throw new VrefError(
      "VREF_IMAGE_READ_FAILED",
      `source image has no usable dimensions: ${sourcePath}`,
    );
  }

  return { width, height };
}

function assertQuality(quality: number | undefined): void {
  if (quality === undefined) {
    return;
  }

  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new VrefError("VREF_INVALID_QUALITY", "--quality must be an integer between 1 and 100");
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
