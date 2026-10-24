/** The Railwalker bird, flat and friendly: a round yellow rail with a small orange beak. For the logo, empty states and wherever 3D is not available. */
export function Bird({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="The Railwalker bird">
      <ellipse cx="60" cy="112" rx="34" ry="4.5" fill="#14231b" opacity="0.12" />
      <path d="M26 74c-9 1-15-3-19-10 9-1 15 1 21 5z" fill="#f1d51a" />
      <ellipse cx="55" cy="70" rx="35" ry="30" fill="#fcff52" />
      <ellipse cx="63" cy="79" rx="22" ry="17" fill="#fffbd4" />
      <ellipse cx="46" cy="70" rx="17" ry="11" fill="#f1d51a" transform="rotate(-14 46 70)" />
      <circle cx="80" cy="45" r="22" fill="#fcff52" />
      <path d="M70 26c-2-8 2-13 7-14-1 5 1 8 5 10zM80 24c1-8 6-11 11-10-2 4-1 8 2 11z" fill="#f1d51a" />
      <circle cx="87" cy="41" r="3.6" fill="#14231b" />
      <circle cx="88.2" cy="39.8" r="1.1" fill="#fff" />
      <circle cx="84" cy="52" r="4.6" fill="#ffb4a6" opacity="0.85" />
      <path d="M98 42l16 6.5L98 55z" fill="#ff9a3c" />
      <path d="M98 50.5l11 1.5-11 3.5z" fill="#e87f22" opacity="0.6" />
      <g stroke="#ff9a3c" strokeWidth="3.6" strokeLinecap="round" fill="none">
        <path d="M50 98v12M66 98v12" />
        <path d="M44 111h12M60 111h12" />
      </g>
    </svg>
  );
}
