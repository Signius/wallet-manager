export async function sendDiscordWebhook(webhookUrl: string, content: string) {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${resp.status} ${resp.statusText} ${text}`.trim());
  }
}


