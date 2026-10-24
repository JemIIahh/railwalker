import Link from 'next/link';

/** The Railwalker mark: the little rail bird on a yellow tile. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 36 36" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="34" height="34" rx="11" fill="#fcff52" stroke="#14231b" strokeWidth="2" />
      <g fill="#14231b">
        <ellipse cx="16" cy="22" rx="10.5" ry="8" />
        <circle cx="22" cy="14.5" r="6.4" />
        <path d="M7.6 19.2 3.4 15.6l1.1 7.1z" />
        <path d="M13.5 29v3.2M19 29v3.2" stroke="#14231b" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <path d="M27.6 13.2 33 15l-5.4 1.8z" fill="#ff9a3c" />
      <circle cx="23.6" cy="13.2" r="1.5" fill="#fcff52" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Railwalker, home">
      <BrandMark />
      <span>Railwalker</span>
    </Link>
  );
}
