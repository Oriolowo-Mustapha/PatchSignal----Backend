"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalDialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function ModalDialog({ open, title, onClose, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Safari light-dismiss fallback when closedby is unsupported
    const supportsClosedBy = "closedBy" in HTMLDialogElement.prototype;
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    };

    if (!supportsClosedBy) {
      dialog.addEventListener("click", handleBackdropClick);
    }
    return () => {
      dialog.removeEventListener("close", handleClose);
      if (!supportsClosedBy) {
        dialog.removeEventListener("click", handleBackdropClick);
      }
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="ps-dialog"
      aria-labelledby={titleId}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="ps-dialog__head">
        <h2 id={titleId} className="ps-dialog__title">
          {title}
        </h2>
        <button
          type="button"
          className="ps-dialog__close"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="ps-dialog__body">{children}</div>
    </dialog>
  );
}
