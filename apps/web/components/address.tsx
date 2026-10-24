import { explorerAddressUrl, shortHash } from '../lib/view-models';

/** A shortened address that links to the explorer, or plain text when it is not a real address: nothing else is ever put in a link. */
export function Address({ value }: { value: string }) {
  const href = explorerAddressUrl(value);
  return href ? (
    <a className="mono" href={href} rel="noreferrer noopener" target="_blank" title={value}>
      {shortHash(value)}
    </a>
  ) : (
    <span className="mono">{shortHash(value)}</span>
  );
}
