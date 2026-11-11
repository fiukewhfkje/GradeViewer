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
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"reload-icon " + className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19.3 8.6a8 8 0 1 0 0 6.8" />
      <path d="m15.3 7.9 4 .7.7-4" />
    </svg>
  );
}
