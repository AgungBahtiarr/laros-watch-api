// Helper function to send WhatsApp messages
async function sendWhatsappReply(
  apiUrl: string,
  authHeader: string,
  phone: string,
  message: string,
  deviceSession?: string
) {
  const body = deviceSession
    ? { device: deviceSession, receiver: phone, message: message }
    : { phone: phone, message: message, is_forwarded: false };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[sendWhatsappReply] Failed to send message: ${response.status}`,
        errorBody
      );
      throw new Error(`WhatsApp API returned an error: ${errorBody}`);
    }

    const waResponse = await response.json();
    console.log("[sendWhatsappReply] WhatsApp API response:", waResponse);
    return waResponse;
  } catch (e) {
    console.error("[sendWhatsappReply] Error sending notification:", e);
    throw e;
  }
}

export default sendWhatsappReply;
