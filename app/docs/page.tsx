import { cookies } from "next/headers";
import { DocsPageClient } from "@/components/docs/docs-page";
import { hasActiveSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function DocsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await hasActiveSessionToken(token);

  return <DocsPageClient initialAuthenticated={isAuthenticated} />;
}
