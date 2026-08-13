import { NextResponse } from "next/server";

export function jsonRouteError(error: unknown, fallbackMessage: string, status = 500) {
  const errorStatus = typeof error === "object" && error && "status" in error && typeof error.status === "number"
    ? error.status
    : status;
  const isPublicError = errorStatus >= 400 && errorStatus < 500;

  if (!isPublicError) {
    console.error(fallbackMessage, error);
  }

  return NextResponse.json({
    error: isPublicError && error instanceof Error ? error.message : fallbackMessage
  }, { status: errorStatus });
}
