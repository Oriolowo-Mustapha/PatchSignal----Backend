"use client";

import * as React from "react";
import { Check } from "lucide-react";

export type PasswordStrengthProps = {
  value: string;
  id?: string;
};

type StrengthCriterion = {
  label: string;
  met: boolean;
};

export function PasswordStrength({ value, id }: PasswordStrengthProps) {
  const criteria: StrengthCriterion[] = React.useMemo(
    () => [
      { label: "At least 8 characters", met: value.length >= 8 },
      { label: "Uppercase & lowercase", met: /[A-Z]/.test(value) && /[a-z]/.test(value) },
      { label: "Numeric digit (0-9)", met: /[0-9]/.test(value) },
      { label: "Special symbol", met: /[^A-Za-z0-9]/.test(value) },
    ],
    [value]
  );

  const metCount = criteria.filter((c) => c.met).length;

  const tone =
    value.length === 0
      ? { label: "Enter password", key: "empty" }
      : metCount <= 1
        ? { label: "Weak", key: "weak" }
        : metCount === 2
          ? { label: "Fair", key: "fair" }
          : metCount === 3
            ? { label: "Good", key: "good" }
            : { label: "Strong", key: "strong" };

  return (
    <div data-ui="password-strength" id={id} className="ps-pw-meter" data-tone={tone.key}>
      <div className="ps-pw-meter__head">
        <span className="ps-pw-meter__title">Password strength</span>
        <span className="ps-pw-meter__label">{tone.label}</span>
      </div>

      <div className="ps-pw-bars" aria-hidden="true">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className={`ps-pw-bar ${value.length > 0 && idx < metCount ? "is-active" : ""}`}
          />
        ))}
      </div>

      <ul className="ps-pw-criteria">
        {criteria.map((c) => (
          <li key={c.label} className={`ps-pw-crit ${c.met ? "is-met" : ""}`}>
            <span className="ps-pw-crit__check" aria-hidden="true">
              {c.met ? <Check size={10} strokeWidth={2.5} /> : null}
            </span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
