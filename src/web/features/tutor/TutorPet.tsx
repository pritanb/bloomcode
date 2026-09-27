/** Bloom: BloomCode's sprout coding tutor. Decorative; the controls supply labels. */
export function TutorPet({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 108"
      fill="none"
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
    >
      <ellipse cx="50" cy="99" rx="28" ry="5" fill="currentColor" opacity=".09" />
      <path d="M48 31C48 21 52 16 60 11" stroke="#31594c" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M50 24C33 26 28 17 28 9C43 7 52 14 50 24Z"
        fill="#84c99c"
        stroke="#31594c"
        strokeWidth="3"
      />
      <path
        d="M52 20C51 7 63 3 73 6C72 18 65 24 52 20Z"
        fill="#b8e1a3"
        stroke="#31594c"
        strokeWidth="3"
      />
      <path
        d="M24 63C12 61 9 71 16 75L24 72M77 62C89 56 95 65 87 71L78 73"
        fill="#c6e7c0"
        stroke="#31594c"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M34 86L31 96C33 100 43 99 44 94M60 87L59 96C63 100 73 99 73 94L69 85"
        fill="#31594c"
      />
      <path
        d="M21 54C21 36 33 29 50 29C69 29 80 40 80 58L77 76C75 87 65 92 49 92C32 92 23 87 22 75Z"
        fill="#dcefd0"
        stroke="#31594c"
        strokeWidth="3"
      />
      <path d="M26 74C34 83 62 87 76 74L74 82C62 94 33 93 25 81Z" fill="#b8dcb5" />
      <rect x="30" y="44" width="41" height="28" rx="12" fill="#f5fae9" />
      <path d="M39 53V56M62 53V56" stroke="#244437" strokeWidth="4" strokeLinecap="round" />
      <path d="M45 64Q50 69 55 64" stroke="#244437" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="33" cy="63" rx="4" ry="2.5" fill="#edaf96" />
      <ellipse cx="68" cy="63" rx="4" ry="2.5" fill="#edaf96" />
      {/* Round glasses keep his face friendly and readable at launcher size. */}
      <g stroke="#263b35" strokeWidth="2.5">
        <rect x="29" y="47" width="18" height="15" rx="6" />
        <rect x="54" y="47" width="18" height="15" rx="6" />
        <path d="M47 53Q50 50 54 53M24 50L29 52M72 52L77 50" />
      </g>
      {/* A tiny terminal connects Bloom to the app's code-mark identity. */}
      <rect
        x="22"
        y="72"
        width="57"
        height="25"
        rx="4"
        fill="#263b35"
        stroke="#162b24"
        strokeWidth="2.5"
      />
      <path
        d="M30 78L35 82L30 86M39 86H46"
        stroke="#c6e7c0"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M56 80H69M56 86H64" stroke="#84c99c" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M18 97H83L79 101H23Z"
        fill="#edf3ee"
        stroke="#263b35"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
