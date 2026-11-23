import "server-only";

export type EmailResult = { ok: true; id?: string } | { ok: false; reason: "not_configured" | "invalid_recipient" | "provider_error" };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  heading: string;
  message: string;
  orderNumber?: string;
  footer?: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM_EMAIL ?? "";
  if (!apiKey || !from) return { ok: false, reason: "not_configured" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return { ok: false, reason: "invalid_recipient" };

  const orderLine = input.orderNumber ? '<p style="margin:0 0 18px;color:#0b5942;font-size:15px"><strong>Order ' + escapeHtml(input.orderNumber) + '</strong></p>' : "";
  const footer = input.footer ?? "POKHAR’S · Rooted in Bihar. Ready for your snack break.";
  const html = '<div style="margin:0;background:#f8efda;padding:32px 16px;font-family:Arial,sans-serif;color:#104b39"><div style="max-width:560px;margin:auto;background:#fff9eb;border:1px solid #e8dfc8;border-radius:16px;padding:28px"><p style="margin:0 0 12px;color:#b84a71;font-size:11px;font-weight:bold;letter-spacing:2px">POKHAR’S</p><h1 style="margin:0 0 16px;font-size:25px">' + escapeHtml(input.heading) + '</h1>' + orderLine + '<p style="margin:0 0 24px;color:#53685d;line-height:1.65">' + escapeHtml(input.message) + '</p><p style="margin:0;color:#819084;font-size:11px">' + escapeHtml(footer) + '</p></div></div>';
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html }),
    cache: "no-store",
  }).catch(() => null);
  if (!response || !response.ok) return { ok: false, reason: "provider_error" };
  const payload = await response.json().catch(() => ({})) as { id?: string };
  return { ok: true, id: payload.id };
}
