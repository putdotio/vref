export type VrefViewport = {
  width: number;
  height: number;
};

export type VrefScreenshot = {
  id: string;
  title: string;
  group: string;
  platform: string;
  device: string;
  viewport: VrefViewport;
  file: string;
  capturedAt: string;
  sizeBytes: number;
  tags: string[];
  notes: string[];
};

export type VrefManifest = {
  version: 1;
  title: string;
  description: string;
  updatedAt: string;
  screenshots: VrefScreenshot[];
};

export type VrefBuildResult = {
  manifestPath: string;
  outputPath: string;
  screenshotCount: number;
  groupCount: number;
  deviceCount: number;
};

export type VrefValidateResult = {
  manifestPath: string;
  screenshotCount: number;
  groupCount: number;
  deviceCount: number;
  /**
   * Image files under the manifest directory no entry references, relative to
   * that directory. Reported, never fatal.
   */
  orphanAssets: string[];
};

export type VrefScreenshotAddResult = {
  dryRun: boolean;
  file: string;
  manifestPath: string;
  reencoded: boolean;
  screenshot: VrefScreenshot;
  screenshotCount: number;
  sourceBytes: number;
  sourcePath: string;
};

export type VrefConversion = {
  id: string;
  from: string;
  fromBytes: number;
  to: string;
  toBytes: number;
};

export type VrefConvertResult = {
  conversions: VrefConversion[];
  convertedCount: number;
  dryRun: boolean;
  manifestPath: string;
  /** Originals the run could not delete. The conversion still succeeded. */
  retainedSources: string[];
  savedBytes: number;
  skippedCount: number;
};

/**
 * The authored half of a screenshot entry.
 *
 * Written out rather than derived from the Schema: deriving it put
 * `import { Schema } from "effect"` into the published declarations, so a
 * consumer of this type had to resolve the same Effect release candidate even
 * though nothing in the runtime surface touches Effect. `manifest.ts` asserts
 * the two stay in step.
 */
export type VrefScreenshotDraft = {
  id: string;
  title: string;
  group: string;
  platform: string;
  device: string;
  viewport?: VrefViewport;
  file?: string;
  capturedAt?: string;
  tags?: readonly string[];
  notes?: readonly string[];
};

export type VrefManifestAddResult = {
  assetExists: boolean;
  dryRun: boolean;
  manifestPath: string;
  screenshot: VrefScreenshot;
  screenshotCount: number;
};
