import type { Metadata } from "next";
import { AuthRouteShell } from "@/components/workspace/auth-route-shell";
import "../workspace/workspace.css";

export const metadata: Metadata = {
  title: "Sign in | PatchSignal",
  description: "Sign in to open your PatchSignal bug verification workspace.",
};

export default function LoginPage() {
  return <AuthRouteShell initialMode="login" />;
}
