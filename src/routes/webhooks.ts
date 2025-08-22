import { Hono } from 'hono';
import { env } from 'hono/adapter';
import { HTTPException } from 'hono/http-exception';
import sendWhatsappReply from '@/utils/send-whatsapp';
import { handleWebhook } from '@/services/webhook';

const webhooksRouter = new Hono();

webhooksRouter.post("/webhook", async (c) => {
    const { WA_API_URL, WA_USERNAME, WA_PASSWORD, WA_DEVICE_SESSION } = env<{
      WA_API_URL: string;
      WA_USERNAME: string;
      WA_PASSWORD: string;
      WA_DEVICE_SESSION: string;
    }>(c);
  
    try {
      const data = await c.req.json();
      console.log("Webhook received:", JSON.stringify(data, null, 2));
  
      if (data.from && data.message?.text) {
        const fromString = data.from;
        let receiver;
  
        if (fromString.includes("@g.us")) {
          receiver = fromString.split(" in ")[1];
        } else {
          const rawJidWithResource = fromString.split(" ")[0];
          receiver = rawJidWithResource.split(":")[0] + "@s.whatsapp.net";
        }
  
        const reply = await handleWebhook(data);
  
        if (reply.text || reply.location) {
          const waApiEndpoint = WA_API_URL;
          const authHeader = `Basic ${btoa(WA_USERNAME + ":" + WA_PASSWORD)}`;
  
          if (reply.text) {
            await sendWhatsappReply(
              waApiEndpoint,
              authHeader,
              receiver,
              reply.text,
              WA_DEVICE_SESSION,
            );
          }
  
          if (reply.location) {
            const sendLocation = await fetch(`${WA_API_URL}/send/location`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
              },
              body: JSON.stringify({
                phone: receiver,
                latitude: reply.location.lat,
                longitude: reply.location.lng,
                is_forwarded: false,
                duration: 3600,
              }),
            });
  
            console.log(sendLocation);
  
            const resLocation = await sendLocation.json();
  
            console.log(resLocation);
          }
  
          return c.json({ status: "success", reply_sent: true });
        }
      } else {
        console.log(
          "Webhook received but format is not as expected or text is missing.",
        );
      }
  
      return c.json({
        status: "success",
        reply_sent: false,
        reason: "No matching keyword or invalid format.",
      });
    } catch (error: any) {
      console.error("Error in /webhook:", error);
      throw new HTTPException(500, {
        message: `Webhook error: ${error.message}`,
      });
    }
  });

export default webhooksRouter;
