import { Schema } from "effect";

export class VrefError extends Schema.TaggedError<VrefError>()("VrefError", {
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(code: string, message: string) {
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

export function errorToJson(error: unknown): {
  ok: false;
  error: { code: string; message: string };
} {
  const normalized = normalizeError(error);

  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };
}
