import { NextResponse } from 'next/server';
import { getServerRuntimeConfig } from '@/services/runtimeConfig';

export const dynamic = 'force-dynamic';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store, max-age=0',
};

export function GET() {
  return NextResponse.json(getServerRuntimeConfig(), { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { headers });
}
