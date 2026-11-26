"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleX,
  ClipboardCheck,
  FileCheck2,
  GitCompareArrows,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { apiClient, ApiRequestError, type UserProfile } from "@/lib/ui/api-client";
import { useAccessibleFormValidation } from "@/lib/ui/use-accessible-form";
import { BrandMark } from "@/components/brand-mark";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/loaders";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "@/components/ui/password-strength";
import { SlidingTabs } from "@/components/ui/sliding-tabs";

type AuthPanelProps = {
  initialMode?: "login" | "signup";
  asLinks?: boolean;
  onAuthenticated: (user: UserProfile) => void;
};

export function AuthPanel({
  initialMode = "login",
  asLinks = false,
  onAuthenticated,
}: AuthPanelProps) {
  const [mode, setMode] = React.useState<"login" | "signup">(initialMode);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [confirmTouched, setConfirmTouched] = React.useState(false);
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  useAccessibleFormValidation(formRef);

  const passwordsMismatch =
    mode === "signup" &&
    ((confirmPassword.length > 0 && confirmPassword !== password) ||
      (confirmTouched && confirmPassword !== password));

  const passwordsMatch =
    mode === "signup" &&
    confirmPassword.length > 0 &&
    password.length >= 8 &&
    confirmPassword === password;

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    setConfirmPassword("");
    setConfirmTouched(false);
    setServerError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    const form = e.currentTarget;

    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector<HTMLElement>(":invalid");
      firstInvalid?.focus();
      return;
    }

    if (mode === "signup" && confirmPassword !== password) {
      setConfirmTouched(true);
      form.querySelector<HTMLInputElement>("#auth-confirm-password")?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res =
        mode === "signup"
          ? await apiClient.signup({ email: email.trim(), password, name: name.trim() || undefined })
          : await apiClient.login({ email: email.trim(), password });
      onAuthenticated({
        id: res.id,
        email: res.email,
        name: res.name,
        lastLoginAt: res.lastLoginAt ?? null,
        createdAt: res.createdAt,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError(err.message);
      } else {
        setServerError("We couldn't sign you in right now. Please try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-vault">
      <header className="auth-topbar">
        <div className="auth-topbar__inner">
          <div className="auth-topbar__left">
            <Link href="/" className="auth-brand-link">
              <BrandMark size={20} pulseColor="#A3E635" animated />
              <span>PatchSignal</span>
            </Link>
            <span className="auth-topbar__sep" aria-hidden="true">
              /
            </span>
            <span className="auth-topbar__crumb">Workspace access</span>
          </div>

          <nav className="auth-topbar__right" aria-label="Authentication navigation">
            <Link href="/" className="auth-top-link auth-top-link--secondary">
              Home
            </Link>
            <Link href="/dashboard" className="auth-top-link">
              Dashboard
            </Link>
            <Link href="/docs" className="auth-top-link auth-top-link--secondary">
              API Docs
            </Link>
            {asLinks ? (
              <Link href={mode === "login" ? "/signup" : "/login"} className="auth-switch-link">
                {mode === "login" ? "Create account" : "Sign in"}
              </Link>
            ) : (
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              >
                {mode === "login" ? "Create account" : "Sign in"}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main id="main-content" className="auth-vault__stage">
        <div className="auth-chamber-frame ps-panel-enter">
          <span className="ps-crosshair ps-crosshair--tl" aria-hidden="true" />
          <span className="ps-crosshair ps-crosshair--tr" aria-hidden="true" />

          <div className="auth-chamber-grid">
            {/* Primary Chamber: Credentials Form */}
            <section className="auth-chamber auth-chamber--form" aria-label="Account credentials">
              <div className="auth-chamber__mode">
                {asLinks ? (
                  <div className="auth-mode-links" role="navigation" aria-label="Account mode">
                    <Link
                      href="/login"
                      className={`auth-mode-link ${mode === "login" ? "is-active" : ""}`}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/signup"
                      className={`auth-mode-link ${mode === "signup" ? "is-active" : ""}`}
                    >
                      Create account
                    </Link>
                  </div>
                ) : (
                  <SlidingTabs
                    ariaLabel="Authentication mode"
                    mode="group"
                    variant="pill"
                    fullWidth
                    value={mode}
                    onChange={switchMode}
                    items={[
                      { id: "login", label: "Sign in" },
                      { id: "signup", label: "Create account" },
                    ]}
                  />
                )}
              </div>

              <div className="auth-card__head">
                <h1 className="auth-title">
                  {mode === "login" ? "Sign in to PatchSignal" : "Create your workspace"}
                </h1>
                <p className="auth-sub">
                  {mode === "login"
                    ? "Enter your account credentials to open your investigation queue"
                    : "Set up an engineering account to verify bug reports and manage drafts"}
                </p>
              </div>

              <form key={mode} ref={formRef} onSubmit={handleSubmit} noValidate className="auth-form ps-panel-enter">
                {mode === "signup" ? (
                  <div className="ps-field">
                    <label htmlFor="auth-name">Full name</label>
                    <div className="ps-input-wrap has-leading">
                      <span className="ps-input-leading" aria-hidden="true">
                        <User size={16} strokeWidth={1.5} />
                      </span>
                      <input
                        id="auth-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        enterKeyHint="next"
                        className="ps-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ada Lovelace"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="ps-field">
                  <label htmlFor="auth-email">Email address</label>
                  <div className="ps-input-wrap has-leading">
                    <span className="ps-input-leading" aria-hidden="true">
                      <Mail size={16} strokeWidth={1.5} />
                    </span>
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      spellCheck={false}
                      enterKeyHint="next"
                      data-error="auth-email-error"
                      className="ps-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div id="auth-email-error" className="ps-error-msg">
                    Please enter a valid email address.
                  </div>
                </div>

                <div>
                  <PasswordInput
                    id="auth-password"
                    name="password"
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    placeholder={mode === "signup" ? "Create a strong password" : "Enter your password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    enterKeyHint={mode === "signup" ? "next" : "done"}
                    required
                    minLength={8}
                    hint={mode === "signup" ? "At least 8 characters" : undefined}
                    errorId="auth-password-error"
                    errorMessage="Use at least 8 characters for your password."
                    leadingIcon={<Lock size={16} strokeWidth={1.5} />}
                  />
                  {mode === "signup" ? <PasswordStrength value={password} /> : null}
                </div>

                {mode === "signup" ? (
                  <PasswordInput
                    id="auth-confirm-password"
                    name="confirmPassword"
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={(next) => {
                      setConfirmPassword(next);
                      if (!confirmTouched) setConfirmTouched(true);
                    }}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    enterKeyHint="done"
                    required
                    errorId="auth-confirm-password-error"
                    errorMessage="Please re-enter your password to confirm."
                    customError={passwordsMismatch ? "Those passwords don't match yet." : null}
                    matchMessage={passwordsMatch ? "Passwords match" : null}
                    leadingIcon={<Lock size={16} strokeWidth={1.5} />}
                  />
                ) : null}

                {serverError ? (
                  <AlertBanner
                    variant="error"
                    context="auth"
                    message={serverError}
                    onDismiss={() => setServerError(null)}
                    compact
                  />
                ) : null}

                <button type="submit" className="auth-submit" disabled={submitting}>
                  {submitting ? <Spinner size={15} /> : null}
                  <span>
                    {submitting
                      ? mode === "login"
                        ? "Signing in…"
                        : "Creating account…"
                      : mode === "login"
                        ? "Sign in"
                        : "Create account"}
                  </span>
                  {submitting ? null : <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </form>

              <div className="auth-card__foot">
                <span>{mode === "login" ? "Need an account?" : "Already have an account?"}</span>
                {asLinks ? (
                  <Link href={mode === "login" ? "/signup" : "/login"} className="auth-inline-link">
                    {mode === "login" ? "Create one" : "Sign in"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => switchMode(mode === "login" ? "signup" : "login")}
                  >
                    {mode === "login" ? "Create one" : "Sign in"}
                  </button>
                )}
              </div>
            </section>

            {/* Secondary Chamber: Live Verification Ledger & Workspace Guarantees */}
            <aside className="auth-chamber auth-chamber--ledger" aria-label="Workspace overview">
              <div className="auth-ledger__head">
                <h2 className="auth-ledger__title">Verification ledger</h2>
                <span className="ws-pill ws-pill--lime">Isolated runs</span>
              </div>

              <div className="auth-snapshot">
                <div className="auth-snapshot__head">
                  <span className="auth-snapshot__repo">
                    <span className="ps-signal-dot" aria-hidden="true" />
                    <span className="mono">meridian-dev/checkout-sdk</span>
                  </span>
                  <span className="mono num auth-snapshot__issue">#418</span>
                </div>
                <p className="auth-snapshot__summary">
                  Plus-addressed emails rejected during guest checkout
                </p>
                <div className="auth-snapshot__rows num">
                  <div className="auth-snapshot__row">
                    <span>Target commit</span>
                    <span className="auth-snapshot__status is-fail">
                      <CircleX size={13} strokeWidth={1.5} aria-hidden="true" />
                      <code className="mono">8f4c21a9 · exit 1</code>
                    </span>
                  </div>
                  <div className="auth-snapshot__row">
                    <span>Baseline commit</span>
                    <span className="auth-snapshot__status is-ok">
                      <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" />
                      <code className="mono">3c09b1d2 · exit 0</code>
                    </span>
                  </div>
                </div>
              </div>

              <ul className="auth-highlights">
                <li>
                  <FileCheck2 size={16} strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <strong>Scoped private queues</strong>
                    <span>Screenshots, evidence timelines, and drafts remain scoped to your account.</span>
                  </div>
                </li>
                <li>
                  <GitCompareArrows size={16} strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <strong>Pinned commit proof</strong>
                    <span>Verify failing assertions against a baseline revision before patching.</span>
                  </div>
                </li>
                <li>
                  <ClipboardCheck size={16} strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <strong>Human-approved issue drafts</strong>
                    <span>Review every Markdown brief and GitHub link before anything goes upstream.</span>
                  </div>
                </li>
              </ul>

              <div className="auth-ledger__foot">
                <span>Private engineering workspaces</span>
                <span className="num">PatchSignal · 2026</span>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
