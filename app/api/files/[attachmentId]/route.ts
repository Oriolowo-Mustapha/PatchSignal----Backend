import { NextResponse } from "next/server";
import { authUser } from "@/lib/auth";
import { findOwnedAttachment } from "@/lib/attachments";

// Ownership-scoped attachment lookup resolving attachmentId (id or publicId)
// to Cloudinary CDN metadata without leaking credentials.
export async function GET(req: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { attachmentId } = await params;
  let decoded = attachmentId;
  try {
    decoded = decodeURIComponent(attachmentId);
  } catch {
    decoded = attachmentId;
  }
  const attachment = await findOwnedAttachment(decoded, auth.userId);
  if (!attachment) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(attachment, { status: 200, headers: { "Cache-Control": "no-store" } });
}
