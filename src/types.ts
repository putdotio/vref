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
};
