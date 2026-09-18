import { Schema } from "effect";
import { VREF_ERROR_CODES, type VrefErrorCode, type VrefErrorJson } from "./error-codes.js";

export class VrefError extends Schema.TaggedError<VrefError>()("VrefError", {
  code: Schema.Literals(VREF_ERROR_CODES),
  message: Schema.String,
}) {
  constructor(code: VrefErrorCode, message: string) {
    super({ code, message });
  }
}

export function normalizeError(error: unknown): VrefError {
  if (error instanceof VrefError) {
    return error;
  }

  if (error instanceof Error) {
    return new VrefError("VREF_UNEXPECTED_ERROR", error.message);
  }

  return new VrefError("VREF_UNKNOWN_THROW", "Unknown error");
}

export function errorToJson(error: unknown): VrefErrorJson {
  const normalized = normalizeError(error);

  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };
}

/** Whether a thrown value is a Node error carrying `code`. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** The readable half of a thrown value. */
export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
