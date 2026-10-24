'use client';

import { useState } from 'react';
import { Icon } from './icons';

/** Copies a piece of text and says so for a moment. Where the browser will not let it, the button simply does nothing. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn icon-btn-sm"
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard not available: nothing to say */
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}
