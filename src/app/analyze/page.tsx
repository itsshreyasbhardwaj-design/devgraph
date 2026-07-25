import { Suspense } from 'react';
import type { Metadata } from 'next';
import { publicFlags } from '@/lib/config/env';
import { AnalyzeClient } from './AnalyzeClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Workspace',
  description: 'Explore a repository as an interactive architecture graph.',
  robots: { index: false, follow: false },
};

export default function AnalyzePage() {
  const flags = publicFlags();

  return (
    <Suspense fallback={<Loading />}>
      <AnalyzeClient aiAvailable={flags.ai} />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="text-ink-faint flex items-center gap-2.5 text-[13px]">
        <span className="bg-edge size-1.5 animate-pulse rounded-full" />
        Preparing workspace
      </div>
    </div>
  );
}
