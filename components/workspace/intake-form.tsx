"use client";

import * as React from "react";
import { ArrowRight, Check } from "lucide-react";
import { apiClient, ApiRequestError } from "@/lib/ui/api-client";
import { useAccessibleFormValidation } from "@/lib/ui/use-accessible-form";
import { AlertBanner } from "@/components/ui/alert-banner";
import { FileDropzone, type SelectedScreenshot } from "@/components/ui/file-dropzone";
import { Spinner } from "@/components/ui/loaders";

type IntakeFormProps = {
  onCreated: (id: string, autoAnalyze: boolean) => Promise<void> | void;
  onAuthExpired: () => void;
};

const PIPELINE_STEPS = [
  "Separate observed screenshot evidence from open questions",
  "Pin the repository commit and inspect the project layout",
  "Generate a targeted reproduction assertion",
  "Run offline comparison and build an editable issue brief",
];

export function IntakeForm({ onCreated, onAuthExpired }: IntakeFormProps) {
  const [repoUrl, setRepoUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [actual, setActual] = React.useState("");
  const [steps, setSteps] = React.useState("");
  const [environment, setEnvironment] = React.useState("");
  const [errorText, setErrorText] = React.useState("");
  const [screenshots, setScreenshots] = React.useState<SelectedScreenshot[]>([]);
  const [autoAnalyze, setAutoAnalyze] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  useAccessibleFormValidation(formRef);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector<HTMLElement>(":invalid");
      firstInvalid?.focus();
      return;
    }

    const fd = new FormData();
    fd.append("repoUrl", repoUrl.trim());
    fd.append("description", description.trim());
    if (expected.trim()) fd.append("expected", expected.trim());
    if (actual.trim()) fd.append("actual", actual.trim());
    if (steps.trim()) fd.append("steps", steps.trim());
    if (environment.trim()) fd.append("environment", environment.trim());
    if (errorText.trim()) fd.append("errorText", errorText.trim());
    for (const s of screenshots.slice(0, 3)) {
      fd.append("screenshots", s.file);
    }

    setSubmitting(true);
    try {
      const created = await apiClient.createInvestigation(fd);
      setDescription("");
      setExpected("");
      setActual("");
      setSteps("");
      setEnvironment("");
      setErrorText("");
      setScreenshots([]);
      await onCreated(created.id, autoAnalyze);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        onAuthExpired();
        return;
      }
      setServerError(
        err instanceof Error ? err.message : "We couldn't submit your bug report. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ws-intake">
      <div className="ws-title-row">
        <div className="ws-title-main">
          <div className="ws-title-badges">
            <h1 className="ws-h1">New bug investigation</h1>
            <span className="ws-pill ws-pill--pos">Stage 1 · Intake</span>
          </div>
          <p className="ws-sub">
            Paste a public GitHub repository link and attach visual evidence to produce a verified commit reproduction.
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="ws-intake-grid">
        {/* Left Main Form Column */}
        <div className="ws-intake-main">
          <section className="ws-intake-card" aria-labelledby="sec-repo-title">
            <div className="ws-intake-card__head">
              <span className="ws-intake-card__num mono num">01</span>
              <h2 id="sec-repo-title" className="ws-intake-card__title">
                Target repository & summary
              </h2>
            </div>

            <div className="ps-field">
              <label htmlFor="intake-repo">GitHub repository URL</label>
              <span id="intake-repo-hint" className="ps-field__hint">
                Public https://github.com/owner/repo URL
              </span>
              <input
                id="intake-repo"
                name="repoUrl"
                type="url"
                required
                pattern={String.raw`https://github\.com/[^\/\s]+/[^\/\s]+`}
                spellCheck={false}
                aria-describedby="intake-repo-hint"
                data-error="intake-repo-error"
                className="ps-input mono"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
              />
              <div id="intake-repo-error" className="ps-error-msg">
                Please enter a valid public GitHub repository link (for example, https://github.com/owner/repo).
              </div>
            </div>

            <div className="ps-field">
              <label htmlFor="intake-desc">Bug description</label>
              <span id="intake-desc-hint" className="ps-field__hint">
                Describe what went wrong. Missing details stay flagged as follow-up questions.
              </span>
              <textarea
                id="intake-desc"
                name="description"
                required
                aria-describedby="intake-desc-hint"
                data-error="intake-desc-error"
                className="ps-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Sign-up rejects email addresses containing a plus sign like ade+test@gmail.com"
              />
              <div id="intake-desc-error" className="ps-error-msg">
                Please describe what went wrong before continuing.
              </div>
            </div>
          </section>

          <section className="ws-intake-card" aria-labelledby="sec-behavior-title">
            <div className="ws-intake-card__head">
              <span className="ws-intake-card__num mono num">02</span>
              <h2 id="sec-behavior-title" className="ws-intake-card__title">
                Expected vs actual state
              </h2>
            </div>

            <div className="ws-grid-2">
              <div className="ps-field">
                <label htmlFor="intake-expected">Expected behavior</label>
                <input
                  id="intake-expected"
                  name="expected"
                  type="text"
                  className="ps-input"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="Account is created cleanly"
                />
              </div>
              <div className="ps-field">
                <label htmlFor="intake-actual">Actual behavior</label>
                <input
                  id="intake-actual"
                  name="actual"
                  type="text"
                  className="ps-input"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  placeholder="Form displays Invalid email address"
                />
              </div>
            </div>

            <div className="ps-field">
              <label htmlFor="intake-env">Environment</label>
              <input
                id="intake-env"
                name="environment"
                type="text"
                className="ps-input"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="Node 24, Chrome 134, macOS"
              />
            </div>
          </section>

          <section className="ws-intake-card" aria-labelledby="sec-logs-title">
            <div className="ws-intake-card__head">
              <span className="ws-intake-card__num mono num">03</span>
              <h2 id="sec-logs-title" className="ws-intake-card__title">
                Reproduction steps & diagnostics
              </h2>
            </div>

            <div className="ws-grid-2">
              <div className="ps-field">
                <label htmlFor="intake-steps">Reproduction steps</label>
                <textarea
                  id="intake-steps"
                  name="steps"
                  className="ps-textarea"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  placeholder="1. Open sign-up form&#10;2. Enter ade+test@gmail.com"
                />
              </div>
              <div className="ps-field">
                <label htmlFor="intake-error">Console / error text</label>
                <textarea
                  id="intake-error"
                  name="errorText"
                  className="ps-textarea mono"
                  value={errorText}
                  onChange={(e) => setErrorText(e.target.value)}
                  placeholder="Optional stack trace or validation error output"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Right Sticky Dispatch & Evidence Column */}
        <aside className="ws-intake-aside">
          <div className="ws-intake-card">
            <div className="ws-intake-card__head">
              <span className="ws-intake-card__num mono num">04</span>
              <h2 className="ws-intake-card__title">Visual evidence</h2>
            </div>
            <FileDropzone files={screenshots} onChange={setScreenshots} maxFiles={3} maxSizeMB={5} />
          </div>

          <div className="ws-intake-card">
            <label className="ws-checkbox-row">
              <input
                type="checkbox"
                className="ps-checkbox"
                checked={autoAnalyze}
                onChange={(e) => setAutoAnalyze(e.target.checked)}
              />
              <span>Queue automated evidence analysis right after creation</span>
            </label>

            {serverError ? (
              <AlertBanner
                variant="error"
                context="intake"
                message={serverError}
                onDismiss={() => setServerError(null)}
                compact
              />
            ) : null}

            <button
              type="submit"
              className="ws-btn ws-btn--primary ws-intake-submit"
              disabled={submitting}
            >
              {submitting ? <Spinner size={15} /> : null}
              <span>{submitting ? "Creating investigation…" : "Create investigation"}</span>
              {submitting ? null : <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          </div>

          <div className="ws-intake-card ws-intake-guide">
            <div className="ws-intake-guide__title">Verification pipeline</div>
            <ul className="ws-intake-guide__list">
              {PIPELINE_STEPS.map((line) => (
                <li key={line}>
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </form>
    </div>
  );
}
