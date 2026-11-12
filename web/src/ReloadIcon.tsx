import type { SVGProps } from "react";

export function ReloadIcon({
  size = 20,
  className = "",
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"reload-icon " + className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.7 9.3a7.8 7.8 0 0 1 14.6 0" />
      <path d="m16.3 7.9 3 1.4 1.3-3" />
      <path d="M19.3 14.7a7.8 7.8 0 0 1-14.6 0" />
      <path d="m7.7 16.1-3-1.4-1.3 3" />
    </svg>
  );
}
