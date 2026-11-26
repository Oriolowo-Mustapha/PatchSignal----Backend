import type { Metadata } from "next";
import "../workspace/workspace.css";
import "./dashboard.css";
import { DashboardApp } from "@/components/dashboard/dashboard-app";

export const metadata: Metadata = {
  title: "Dashboard | PatchSignal",
  description:
    "Operational overview of bug reproductions, automated fix loops, GitHub Pull Requests, CI status, and sandbox health.",
};

export default function DashboardPage() {
  return <DashboardApp />;
}
