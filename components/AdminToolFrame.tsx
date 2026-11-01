"use client";

import { useState } from "react";

import { AdminBar } from "@/components/AdminBar";

type AdminToolFrameProps = {
  title: string;
  src: string;
  emptyHint?: string;
};

export function AdminToolFrame({ title, src, emptyHint }: AdminToolFrameProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const ready = Boolean(src);

  return (
    <div className="min-h-screen bg-black">
      <AdminBar
        title={title}
        extra={
          ready ? (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/50 transition hover:text-white"
            >
              Open in new tab ↗
            </a>
          ) : null
        }
      />

      <div className="pt-14">
        <div className="relative h-[calc(100vh-3.5rem)] w-full">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-black px-6">
              <p className="max-w-md text-center text-sm text-white/50">
                {emptyHint ?? "This tool is not configured yet."}
              </p>
            </div>
          )}
          {ready && !iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />
                <p className="text-sm text-white/50">Loading {title}…</p>
              </div>
            </div>
          )}
          {ready && (
            <iframe
              src={src}
              title={title}
              className="h-full w-full border-0"
              onLoad={() => setIframeLoaded(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
