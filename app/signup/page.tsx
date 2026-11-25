import type { Metadata } from "next";
import { AuthRouteShell } from "@/components/workspace/auth-route-shell";
import "../workspace/workspace.css";

export const metadata: Metadata = {
  title: "Create account | PatchSignal",
  description: "Create a PatchSignal account to reproduce and verify bug reports.",
};

export default function SignupPage() {
  return <AuthRouteShell initialMode="signup" />;
}
