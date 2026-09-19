// No Effect import here on purpose: index.ts publishes this module, and the
// declarations it emits must not drag an Effect release candidate into a
// consumer's type resolution. src/types.ts carries the same constraint.

/**
 * Every code `vref` can put in `error.code`.
 *
 * Published so automation can branch on the code instead of matching message
 * text, and narrow enough that the compiler refuses a code that is not listed:
 * adding one here is the only way to throw it.
 */
export const VREF_ERROR_CODES = [
  "VREF_ASSET_CHECK_FAILED",
  "VREF_ASSET_CLAIMED",
  "VREF_ASSET_EXISTS",
  "VREF_ASSET_MISSING",
  "VREF_ASSET_NOT_FILE",
  "VREF_BAD_SERVE_PATH",
  "VREF_CONVERT_TARGET_COLLISION",
  "VREF_EMPTY_FLAG",
  "VREF_EMPTY_SELECTOR",
  "VREF_FIELD_IMMUTABLE",
  "VREF_ENCODER_UNAVAILABLE",
  "VREF_IMAGE_ENCODE_FAILED",
  "VREF_IMAGE_READ_FAILED",
  "VREF_INVALID_BOOLEAN",
  "VREF_INVALID_FIELDS",
  "VREF_INVALID_NUMBER",
  "VREF_INVALID_QUALITY",
  "VREF_JSON_INVALID",
  "VREF_JSON_REQUIRED",
  "VREF_MANIFEST_DUPLICATE_ID",
  "VREF_MANIFEST_JSON_INVALID",
  "VREF_MANIFEST_READ_FAILED",
  "VREF_MANIFEST_SCHEMA_INVALID",
  "VREF_MANIFEST_UNSUPPORTED_VERSION",
  "VREF_PATH_CHECK_FAILED",
  "VREF_PATH_NOT_DIRECTORY",
  "VREF_PATH_OUTSIDE_CWD",
  "VREF_PATH_OUTSIDE_ROOT",
  "VREF_SERVE_DIR_NOT_DIRECTORY",
  "VREF_SERVE_DIR_READ_FAILED",
  "VREF_SERVE_LISTEN_FAILED",
  "VREF_SERVE_START_FAILED",
  "VREF_SOURCE_REQUIRED",
  "VREF_SYMLINK_PATH",
  "VREF_TARGET_CLAIMED",
  "VREF_TARGET_NOT_FILE",
  "VREF_UNEXPECTED_ERROR",
  "VREF_UNKNOWN_COMMAND",
  "VREF_UNKNOWN_FIELD",
  "VREF_UNKNOWN_FLAG",
  "VREF_UNKNOWN_SELECTOR",
  "VREF_UNKNOWN_THROW",
  "VREF_UNSAFE_ASSET_PATH",
  "VREF_UNSAFE_PATH",
  "VREF_UNSUPPORTED_IMAGE",
  "VREF_UNSUPPORTED_SOURCE_IMAGE",
] as const;

export type VrefErrorCode = (typeof VREF_ERROR_CODES)[number];

/** The body every failing command prints under `--output json`. */
export type VrefErrorJson = {
  ok: false;
  error: { code: VrefErrorCode; message: string };
};
