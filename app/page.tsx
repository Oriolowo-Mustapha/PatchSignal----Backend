import "./landing.css";
import { cookies } from "next/headers";
import { LandingPage } from "@/components/landing/landing-page";
import { hasActiveSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await hasActiveSessionToken(token);

  return <LandingPage initialAuthenticated={isAuthenticated} />;
}
