export function BrandMark({ size = 22, pulseColor = "#A3E635" }: { size?: number; pulseColor?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="2.25"
        width="19.5"
        height="19.5"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.5 13h3.25l2-4.75 2.5 7.5 2-4.25h3.25"
        stroke={pulseColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
