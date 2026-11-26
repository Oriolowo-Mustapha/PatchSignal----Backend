"use client";

import * as React from "react";
import { AlertCircle, Image as ImageIcon, Upload, X } from "lucide-react";

/**
 * Adapted from 21st.dev `File Dropzone` (id: 19201, author: joyco).
 * Enforces PatchSignal intake constraints: max 3 PNG/JPEG files, 5 MB each,
 * with accessible thumbnail previews and live error feedback.
 */

export type SelectedScreenshot = {
  id: string;
  file: File;
  previewUrl: string;
};

type FileDropzoneProps = {
  files: SelectedScreenshot[];
  onChange: (next: SelectedScreenshot[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  describedById?: string;
};

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);

export function FileDropzone({
  files,
  onChange,
  maxFiles = 3,
  maxSizeMB = 5,
  describedById,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generatedHintId = React.useId();
  const hintId = describedById ?? generatedHintId;

  const filesRef = React.useRef(files);
  filesRef.current = files;

  React.useEffect(() => {
    return () => {
      for (const item of filesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setError(null);
    const maxBytes = maxSizeMB * 1024 * 1024;
    const next = [...files];

    for (const file of Array.from(incoming)) {
      if (next.length >= maxFiles) {
        setError(`You can attach up to ${maxFiles} screenshots.`);
        break;
      }
      if (!ACCEPTED_TYPES.has(file.type)) {
        setError(`"${file.name}" isn't a supported image format. Please choose a PNG or JPEG image.`);
        continue;
      }
      if (file.size > maxBytes) {
        setError(`"${file.name}" is too large. Each screenshot must be under ${maxSizeMB}\u00a0MB.`);
        continue;
      }
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = URL.createObjectURL(file);
      next.push({ id, file, previewUrl });
    }
    onChange(next);
  };

  const removeFile = (id: string) => {
    const target = files.find((f) => f.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    setError(null);
    onChange(files.filter((f) => f.id !== id));
  };

  return (
    <div data-ui="dropzone" className="ps-dropzone">
      <div
        className="ps-dropzone__area"
        data-dragging={dragging ? "true" : undefined}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          multiple={maxFiles > 1}
          aria-label="Upload bug screenshots"
          aria-describedby={hintId}
          className="visually-hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <ImageIcon size={18} strokeWidth={1.5} className="ps-dropzone__icon" aria-hidden="true" />
        <p className="ps-dropzone__title">Drop bug screenshots here</p>
        <p id={hintId} className="ps-dropzone__sub">
          PNG or JPEG, up to {maxSizeMB}&nbsp;MB each, maximum {maxFiles} files
        </p>
        <button
          type="button"
          className="ps-dropzone__btn"
          disabled={files.length >= maxFiles}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} strokeWidth={1.5} aria-hidden="true" />
          Select screenshots
        </button>
      </div>

      {error ? (
        <div className="ps-dropzone__alert" role="alert">
          <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="ps-dropzone__list" aria-label="Selected screenshots">
          {files.map((item) => (
            <li key={item.id} className="ps-dropzone__item">
              <img
                src={item.previewUrl}
                alt={`Preview of ${item.file.name}`}
                className="ps-dropzone__thumb"
                width={40}
                height={40}
              />
              <div className="ps-dropzone__meta">
                <p className="ps-dropzone__name">{item.file.name}</p>
                <p className="ps-dropzone__size">
                  {item.file.size < 1024 * 1024
                    ? `${Math.max(1, Math.round(item.file.size / 1024))}\u00a0KB`
                    : `${(item.file.size / (1024 * 1024)).toFixed(2)}\u00a0MB`}
                </p>
              </div>
              <button
                type="button"
                className="ps-dropzone__remove"
                aria-label={`Remove ${item.file.name}`}
                onClick={() => removeFile(item.id)}
              >
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
