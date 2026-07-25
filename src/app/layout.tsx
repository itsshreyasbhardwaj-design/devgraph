import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import './globals.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-plex-sans',
  display: 'swap',
  weight: ['400', '500', '600'],
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'DevGraph — see the architecture of any codebase',
    template: '%s · DevGraph',
  },
  description:
    'DevGraph reads a repository and draws it: imports, calls, classes, components, API routes, database schema, and the dependency cycles nobody meant to create.',
  keywords: [
    'code visualization',
    'software architecture',
    'dependency graph',
    'static analysis',
    'code metrics',
    'developer tools',
  ],
  openGraph: {
    type: 'website',
    title: 'DevGraph — see the architecture of any codebase',
    description:
      'Interactive architecture diagrams, metrics and AI insights for repositories in eight languages.',
    siteName: 'DevGraph',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DevGraph',
    description: 'See the architecture of any codebase.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#08080c',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="focus:bg-edge sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-100 focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <TooltipProvider delayDuration={300} skipDelayDuration={200}>
          {children}
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: 'glass !rounded-md !text-[13px] !text-ink',
            duration: 5000,
          }}
        />
      </body>
    </html>
  );
}
