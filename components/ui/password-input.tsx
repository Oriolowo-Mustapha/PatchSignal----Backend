"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";

export type PasswordInputProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>["enterKeyHint"];
  required?: boolean;
  minLength?: number;
  hint?: string;
  errorId?: string;
  errorMessage?: string;
  customError?: string | null;
  matchMessage?: string | null;
  leadingIcon?: React.ReactNode;
};

export function PasswordInput({
  id,
  name,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  enterKeyHint = "done",
  required = true,
  minLength,
  hint,
  errorId,
  errorMessage,
  customError,
  matchMessage,
  leadingIcon,
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);

  const hintId = hint ? `${id}-hint` : undefined;
  const statusId = customError || matchMessage ? `${id}-status` : undefined;
  const describedBy = [hintId, statusId].filter(Boolean).join(" ") || undefined;

  const inputStateClass = customError
    ? "ps-input is-invalid"
    : matchMessage
      ? "ps-input is-valid"
      : "ps-input";

  return (
    <div className="ps-field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span id={hintId} className="ps-field__hint">
          {hint}
        </span>
      ) : null}

      <div className={leadingIcon ? "ps-pw-wrap has-leading" : "ps-pw-wrap"}>
        {leadingIcon ? (
          <span className="ps-input-leading" aria-hidden="true">
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={customError ? "true" : undefined}
          data-error={errorId}
          className={inputStateClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="ps-pw-toggle"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>

      {customError ? (
        <div id={statusId} className="ps-field-status is-err" role="alert">
          <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{customError}</span>
        </div>
      ) : matchMessage ? (
        <div id={statusId} className="ps-field-status is-ok">
          <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{matchMessage}</span>
        </div>
      ) : null}

      {errorId && errorMessage && !customError ? (
        <div id={errorId} className="ps-error-msg">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
