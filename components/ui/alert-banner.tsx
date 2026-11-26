"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { formatErrorMessage, type ErrorContext } from "@/lib/ui/error-messages";

export type AlertBannerProps = {
  variant?: "error" | "warning" | "info";
  title?: string;
  message: string;
  context?: ErrorContext;
  compact?: boolean;
  onDismiss?: () => void;
  className?: string;
};

export function AlertBanner({
  variant = "error",
  title,
  message,
  context,
  compact = false,
  onDismiss,
  className,
}: AlertBannerProps) {
  const formatted =
    variant === "error" && !title
      ? formatErrorMessage(message, context)
      : { title: title ?? "", message };

  const resolvedTitle = formatted.title;
  const resolvedMessage = formatted.message;

  const Icon =
    variant === "error" ? AlertCircle : variant === "warning" ? AlertTriangle : Info;

  return (
    <div
      className={[
        "ps-alert",
        `ps-alert--${variant}`,
        compact ? "is-compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      <span className="ps-alert__icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
      </span>

      <div className="ps-alert__body">
        {resolvedTitle ? <div className="ps-alert__title">{resolvedTitle}</div> : null}
        <p className="ps-alert__message">{resolvedMessage}</p>
      </div>

      {onDismiss ? (
        <button
          type="button"
          className="ps-alert__dismiss"
          aria-label="Dismiss message"
          onClick={onDismiss}
        >
          <X size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
