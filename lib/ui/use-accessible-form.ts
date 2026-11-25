"use client";

import { useEffect, type RefObject } from "react";

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isFormField(el: EventTarget | null): el is FormField {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

/**
 * Synchronizes :user-invalid (with WeakMap fallback when unsupported) to
 * aria-invalid, dynamic aria-describedby (only while invalid), and a single
 * polite live-region announcement per modern-web-guidance.
 */
export function useAccessibleFormValidation(formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const supportsUserInvalid =
      typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("selector(:user-invalid)");
    const dirtyState = new WeakMap<FormField, { interacted: boolean; blurred: boolean }>();
    const flagged = new WeakSet<FormField>();
    const announced = new WeakSet<FormField>();
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    let announcedField: FormField | undefined;

    const announcer = document.createElement("div");
    announcer.setAttribute("aria-live", "polite");
    announcer.className = "visually-hidden";
    document.body.append(announcer);

    const linkError = (el: FormField, shown: boolean) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    };

    const spokenText = (node: HTMLElement): string => {
      const copy = node.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
        n.replaceWith(`${n.getAttribute("aria-label")}: `);
      });
      return (copy.textContent || "").replace(/\s+/g, " ").trim();
    };

    const announceError = (el: FormField) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const errorEl = document.getElementById(errorId);
      if (!errorEl) return;
      const labelEl = el.labels?.[0];
      const prefix = labelEl ? `${spokenText(labelEl)}: ` : "";
      clearTimeout(announceTimer);
      announcer.textContent = "";
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = prefix + spokenText(errorEl);
      }, 500);
    };

    const syncAria = (el: EventTarget | null, announce = false) => {
      if (!isFormField(el)) return;
      const invalid = supportsUserInvalid
        ? el.matches(":user-invalid")
        : Boolean(dirtyState.get(el)?.blurred && !el.validity.valid);

      if (!supportsUserInvalid && dirtyState.get(el)?.blurred) {
        el.classList.toggle("user-invalid-fallback", !el.validity.valid);
      }

      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute("aria-invalid", "true");
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = "";
        }
      }
    };

    form.querySelectorAll("input, select, textarea").forEach((el) => {
      if (isFormField(el)) {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
      }
    });

    const onBlur = (e: Event) => {
      if (!isFormField(e.target)) return;
      const cur = dirtyState.get(e.target) ?? { interacted: false, blurred: false };
      cur.blurred = true;
      dirtyState.set(e.target, cur);
      if (supportsUserInvalid || cur.interacted) syncAria(e.target, true);
    };

    const onInput = (e: Event) => {
      if (!isFormField(e.target)) return;
      const cur = dirtyState.get(e.target) ?? { interacted: false, blurred: false };
      cur.interacted = true;
      dirtyState.set(e.target, cur);
      if (e.target.hasAttribute("aria-invalid")) syncAria(e.target, false);
    };

    const onChange = (e: Event) => {
      if (!isFormField(e.target)) return;
      const cur = dirtyState.get(e.target) ?? { interacted: true, blurred: true };
      cur.interacted = true;
      cur.blurred = true;
      dirtyState.set(e.target, cur);
      syncAria(e.target, true);
    };

    const onInvalid = (e: Event) => {
      if (!isFormField(e.target)) return;
      dirtyState.set(e.target, { interacted: true, blurred: true });
      announced.add(e.target);
      syncAria(e.target, false);
    };

    const onReset = () => {
      setTimeout(() => {
        form.querySelectorAll("input, select, textarea").forEach((el) => {
          if (isFormField(el)) {
            dirtyState.delete(el);
            el.classList.remove("user-invalid-fallback");
            flagged.delete(el);
            announced.delete(el);
            el.setAttribute("aria-invalid", "false");
            linkError(el, false);
          }
        });
      });
    };

    form.addEventListener("blur", onBlur, true);
    form.addEventListener("input", onInput);
    form.addEventListener("change", onChange, true);
    form.addEventListener("invalid", onInvalid, true);
    form.addEventListener("reset", onReset, true);

    return () => {
      clearTimeout(announceTimer);
      form.removeEventListener("blur", onBlur, true);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onChange, true);
      form.removeEventListener("invalid", onInvalid, true);
      form.removeEventListener("reset", onReset, true);
      announcer.remove();
    };
  }, [formRef]);
}
