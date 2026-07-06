import { NextResponse } from "next/server";

export function jsonRouteError(error: unknown, fallbackMessage: string, status = 500) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : fallbackMessage
  }, { status });
}
