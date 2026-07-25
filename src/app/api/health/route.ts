import { NextResponse } from 'next/server';
import { publicFlags } from '@/lib/config/env';
import { getAnalysisStore } from '@/lib/storage';
import { ANALYSIS_VERSION } from '@/lib/analysis/pipeline';
import { parsers } from '@/lib/parsing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness and capability probe. Reports which optional integrations are on. */
export async function GET(): Promise<Response> {
  const store = await getAnalysisStore();
  return NextResponse.json(
    {
      status: 'ok',
      analysisVersion: ANALYSIS_VERSION,
      storage: store.kind,
      languages: parsers
        .list()
        .map((parser) => parser.id)
        .sort(),
      features: publicFlags(),
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
