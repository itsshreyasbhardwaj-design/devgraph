'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  { label: 'honojs/hono', hint: 'TypeScript · web framework' },
  { label: 'pallets/flask', hint: 'Python · web framework' },
  { label: 'gin-gonic/gin', hint: 'Go · HTTP router' },
  { label: 'BurntSushi/ripgrep', hint: 'Rust · CLI' },
];

/**
 * The single entry control for the whole product.
 *
 * Accepts a GitHub reference in any of the forms people actually paste, or a
 * `.zip` dropped straight onto the field. Validation is deliberately permissive
 * here and strict on the server — the field should never argue with a paste
 * that the analyzer would have accepted.
 */
export function RepoInput({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const submit = (repository: string) => {
    const trimmed = repository.trim();
    if (!trimmed) {
      toast.error('Enter a GitHub repository to analyse.');
      return;
    }
    setBusy(true);
    router.push(`/analyze?repo=${encodeURIComponent(trimmed)}`);
  };

  const handleUpload = (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      toast.error('Only .zip archives are supported.');
      return;
    }
    // Hand the File to the workspace through a one-shot module-level slot;
    // a File cannot survive a URL round trip.
    pendingUpload.file = file;
    router.push('/analyze?upload=1');
  };

  return (
    <div className={cn('w-full', className)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) handleUpload(file);
        }}
        className={cn(
          'group bg-pit/90 relative flex items-center gap-2 rounded-lg border p-1.5 transition-all duration-200',
          dragging
            ? 'border-edge bg-edge/10 ring-edge/30 ring-2'
            : 'border-line hover:border-line-strong focus-within:border-edge/60 focus-within:ring-edge/20 focus-within:ring-2',
        )}
      >
        <span
          aria-hidden
          className="tabular text-ink-ghost hidden pl-3 text-[13px] select-none sm:block"
        >
          github.com/
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label="GitHub repository"
          placeholder="owner/repo"
          className="tabular text-ink placeholder:text-ink-ghost min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none sm:pl-0"
        />

        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Upload a .zip archive"
          title="Upload a .zip archive"
          onClick={() => fileInput.current?.click()}
        >
          <FileArchive />
        </Button>
        <Button type="submit" variant="accent" size="sm" disabled={busy} className="px-4">
          {busy ? <Loader2 className="animate-spin" /> : null}
          Analyze
          {busy ? null : <ArrowRight />}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-ink-ghost text-[11px]">Try</span>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => submit(suggestion.label)}
            title={suggestion.hint}
            className="tabular border-line/70 text-ink-faint hover:border-edge/50 hover:bg-edge/10 hover:text-edge-soft rounded-xs border px-1.5 py-0.5 text-[11px] transition-colors"
          >
            {suggestion.label}
          </button>
        ))}
        <span className="text-ink-ghost ml-auto text-[11px]">or drop a .zip</span>
      </div>
    </div>
  );
}

/**
 * A `File` cannot be encoded into a URL, so the upload is parked here for the
 * workspace route to collect on mount. Module scope survives client navigation;
 * a full reload correctly clears it and the workspace falls back to the form.
 */
export const pendingUpload: { file: File | null } = { file: null };
