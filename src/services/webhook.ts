import { db } from "@/db";
import { nodes } from "@/db/schema";
import { like } from "drizzle-orm";

export async function handleWebhook(body: any): Promise<string> {
  const messageBody = (body.message?.text || "").toLowerCase();
  let replyText = "";

  if (messageBody === "!devices") {
    const allNodes = await db.query.nodes.findMany({
      columns: {
        name: true,
      },
    });

    if (allNodes.length > 0) {
      const deviceList = allNodes
        .map((node, index) => `${index + 1}. ${node.name}`)
        .join("\n");
      replyText = `*Berikut daftar perangkat yang tersedia:*\n-----------------------------------\n${deviceList}`;
    } else {
      replyText = "Tidak ada perangkat yang tersedia saat ini.";
    }
  } else if (messageBody.startsWith("!deviceinfo")) {
    const arg = messageBody.substring("!deviceinfo".length).trim();
    if (!arg) {
      replyText =
        "Format perintah salah. Gunakan `!deviceinfo <nama_perangkat>` atau `!deviceinfo <nama_perangkat>.<nama_interface>` atau `!deviceinfo <nama_perangkat>.portlist`.";
    } else {
      const parts = arg.split(".");
      const deviceName = parts[0];
      const detail = parts.length > 1 ? parts[1] : null;

      const device = await db.query.nodes.findFirst({
        where: like(nodes.name, `%${deviceName}%`),
        with: {
          interfaces: {
            columns: {
              ifName: true,
              ifDescr: true,
              ifOperStatus: true,
              opticalRx: true,
              opticalTx: true,
            },
          },
        },
      });

      if (!device) {
        replyText = `Perangkat dengan nama "${deviceName}" tidak ditemukan.`;
      } else {
        if (detail) {
          if (detail.toLowerCase() === "portlist") {
            if (device.interfaces && device.interfaces.length > 0) {
              const interfaceList = device.interfaces
                .map(
                  (iface, index) =>
                    `${index + 1}. ${iface.ifName} (${iface.ifDescr})`
                )
                .join("\n");
              replyText = `*Daftar Port untuk ${device.name}:*\n-----------------------------------\n${interfaceList}`;
            } else {
              replyText = `Tidak ada port yang ditemukan untuk perangkat ${device.name}.`;
            }
          } else {
            // Request for a specific interface
            const interfaceName = detail;
            const iface = device.interfaces.find(
              (i) =>
                i.ifName?.toLowerCase().includes(interfaceName.toLowerCase()) ||
                i.ifDescr?.toLowerCase().includes(interfaceName.toLowerCase())
            );

            if (iface) {
              const rx = iface.opticalRx || "N/A";
              const tx = iface.opticalTx || "N/A";
              replyText = `*Informasi Interface: ${
                iface.ifName
              }*\n-----------------------------------\n*Perangkat:* ${
                device.name
              }\n*Deskripsi:* ${iface.ifDescr || "N/A"}\n*Status:* ${
                iface.ifOperStatus === 1 ? "UP" : "DOWN"
              }\n*Optical RX:* ${rx}\n*Optical TX:* ${tx}`;
            } else {
              replyText = `Interface dengan nama "${interfaceName}" tidak ditemukan di perangkat ${device.name}.`;
            }
          }
        } else {
          // General device info
          let interfacesText = "Tidak ada data interface.";
          if (device.interfaces && device.interfaces.length > 0) {
            interfacesText = device.interfaces
              .map((iface) => {
                const statusIcon = iface.ifOperStatus === 1 ? "🟢" : "🔴";
                const rx = iface.opticalRx || "N/A";
                const tx = iface.opticalTx || "N/A";
                return `${statusIcon} *${iface.ifName}* (${
                  iface.ifDescr || "N/A"
                })\n   └─ RX/TX: ${rx} / ${tx}`;
              })
              .join("\n\n");
          }
          replyText = `*Informasi Perangkat: ${
            device.name
          }*\n-----------------------------------\n*Lokasi:* ${
            device.popLocation || "N/A"
          }\n*IP Manajemen:* ${device.ipMgmt || "N/A"}\n*Status:* ${
            device.status ? "UP" : "DOWN"
          }\n-----------------------------------\n*Interfaces:*\n${interfacesText}`;
        }
      }
    }
  } else if (messageBody === "!menu") {
    replyText =
      "Berikut menu yang tersedia:\n1. `!devices` - Untuk melihat semua perangkat yang tersedia.\n2. `!deviceinfo <nama perangkat>` - Untuk mendapatkan informasi detail tentang perangkat tertentu.\n3. `!deviceinfo <nama perangkat>.portlist` - Untuk melihat daftar port pada perangkat.\n4. `!deviceinfo <nama perangkat>.<nama interface>` - Untuk melihat detail interface pada perangkat.";
  }

  return replyText;
}
