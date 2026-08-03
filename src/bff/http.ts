/** Envelope {code, message, data} — giữ ĐÚNG format backend để FE không phải phân biệt mock/real. */
import { NextResponse } from 'next/server';
import { GatewayError } from './gateway';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ code: 200, message: 'OK', data });
}

export function fail(error: unknown): NextResponse {
  if (error instanceof GatewayError) {
    return NextResponse.json(
      { code: 400, message: error.message, errorCode: error.errorCode, data: null },
      { status: 400 },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ code: 500, message, data: null }, { status: 500 });
}
