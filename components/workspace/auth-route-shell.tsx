"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiClient, clearLegacyStoredToken } from "@/lib/ui/api-client";
import { AuthPanel } from "./auth-panel";

export function AuthRouteShell({ initialMode }: { initialMode: "login" | "signup" }) {
  const router = useRouter();

  React.useEffect(() => {
    let cancelled = false;
    clearLegacyStoredToken();

    apiClient
      .me()
      .then(() => {
        if (!cancelled) router.replace("/workspace");
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AuthPanel
      initialMode={initialMode}
      asLinks
      onAuthenticated={() => {
        router.push("/workspace");
      }}
    />
  );
}
