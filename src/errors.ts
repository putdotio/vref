export class VrefError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VrefError";
    this.code = code;
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
