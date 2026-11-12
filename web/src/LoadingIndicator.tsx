import type { SVGProps } from "react";
import { ReloadIcon } from "./ReloadIcon";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Indeterminate while working; pull progress describes only the user's gesture. */
export function LoadingIndicator({
  size = 20,
  active = true,
  progress,
  className = "",
  ...props
}: IconProps & { active?: boolean; progress?: number }) {
  const sweep =
    progress === undefined || active
      ? 38
      : 8 + Math.max(0, Math.min(1, progress)) * 64;
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className={"loading-indicator " + className}
      data-active={active}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="loading-track"
        cx="12"
        cy="12"
        r="8.25"
        strokeWidth="1.8"
      />
      <g className="loading-orbit">
        <circle
          cx="12"
          cy="12"
          r="8.25"
          pathLength="100"
          strokeWidth="2.1"
          strokeDasharray={`${sweep} 100`}
          transform="rotate(-90 12 12)"
        />
        <circle
          className="loading-tail"
          cx="12"
          cy="12"
          r="8.25"
          pathLength="100"
          strokeWidth="2.1"
          strokeDasharray="9 100"
          transform="rotate(72 12 12)"
        />
      </g>
      <circle
        className="loading-inner"
        cx="12"
        cy="12"
        r="4.25"
        pathLength="100"
        strokeWidth="1.7"
        strokeDasharray="24 100"
      />
    </svg>
  );
}

export function RefreshIcon({
  loading = false,
  ...props
}: IconProps & { loading?: boolean }) {
  return loading ? <LoadingIndicator {...props} /> : <ReloadIcon {...props} />;
}
