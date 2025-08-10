import sendWhatsappReply from "@/utils/send-whatsapp";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { eq } from "drizzle-orm";

type WhatsappCredentials = {
  apiUrl: string;
  groupId: string;
  username: string;
  password: string;
};
type ChangeData = { nodeChanges: any[]; interfaceChanges: any[] };

export async function sendChangeNotification(
  creds: WhatsappCredentials,
  data: ChangeData,
) {
  const { nodeChanges, interfaceChanges } = data;
  if (nodeChanges.length === 0 && interfaceChanges.length === 0) {
    console.log("No status changes detected. No notification sent.");
    return {
      success: true,
      notification_sent: false,
      reason: "No status changes detected.",
    };
  }
  const now = new Date();
  const timestamp = now.toLocaleString("id-ID", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "Asia/Jakarta",
  });
  let messageLines = [
    `*🚨 Laporan Status Jaringan 🚨*`,
    `*Waktu:* ${timestamp}`,
    `-----------------------------------`,
  ];

  const authHeader = `Basic ${btoa(creds.username + ":" + creds.password)}`;

  if (nodeChanges.length > 0) {
    messageLines.push(`*Perubahan Status Perangkat:*`);
    for (const node of nodeChanges) {
      const icon = node.current_status === "UP" ? "✅" : "❌";
      messageLines.push(
        `${icon} *${node.name}* (${node.ipMgmt}) sekarang *${node.current_status}*`,
      );

      // Assuming node.id from sync is deviceId in our db
      const nodeDetails = await db.query.nodes.findFirst({
        where: eq(nodes.deviceId, node.id),
      });

      console.log(nodeDetails);

      if (nodeDetails && nodeDetails.lat && nodeDetails.lng) {
        console.log(`Node ${node.name} has location.`);

        const response = await fetch(`${creds.apiUrl}/send/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            phone: creds.groupId,
            latitude: nodeDetails.lat,
            longitude: nodeDetails.lng,
            is_forwarded: false,
            duration: 3600,
          }),
        });
        console.log(response);
        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Failed to send location for ${node.name}: ${response.status} ${response.statusText} - ${errorText}`,
          );
        }
      }
    }
    messageLines.push(``);
  }

  if (interfaceChanges.length > 0) {
    messageLines.push(`*Perubahan Status Interface:*`);
    interfaceChanges.forEach((iface: any) => {
      const icon = iface.current_status === "UP" ? "🟢" : "🔴";
      const description = iface.description ? ` (${iface.description})` : "";
      messageLines.push(
        `${icon} *${iface.name}*${description} di _${iface.nodeName}_ sekarang *${iface.current_status}*`,
      );
    });
    messageLines.push(``);
  }
  messageLines.push(`_Pesan ini dibuat secara otomatis._`);
  const finalMessage = messageLines.join("\n");
  try {
    await sendWhatsappReply(
      creds.apiUrl,
      authHeader,
      creds.groupId,
      finalMessage,
    );
    return {
      success: true,
      notification_sent: true,
      data_sent: { nodeChanges, interfaceChanges },
    };
  } catch (e) {
    throw new HTTPException(500, {
      message: "Failed to send notification via WhatsApp.",
    });
  }
}
