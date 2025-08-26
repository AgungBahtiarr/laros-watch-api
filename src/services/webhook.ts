import { db } from "@/db";
import { nodes, domains } from "@/db/schema";
import { like } from "drizzle-orm";
import { getDomains, getDomainByName } from "@/services/domain";

export async function handleWebhook(
  body: any,
): Promise<{ text?: string; location?: { lat: string; lng: string } }> {
  const messageBody = (body.message?.text || "").toLowerCase();
  let reply: { text?: string; location?: { lat: string; lng: string } } = {};

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
      reply.text = `*Berikut daftar perangkat yang tersedia:*\n-----------------------------------\n${deviceList}`;
    } else {
      reply.text = "Tidak ada perangkat yang tersedia saat ini.";
    }
  } else if (messageBody.startsWith("!deviceinfo")) {
    const arg = messageBody.substring("!deviceinfo".length).trim();
    if (!arg) {
      reply.text =
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
        reply.text = `Perangkat dengan nama "${deviceName}" tidak ditemukan.`;
      } else {
        if (detail) {
          if (detail.toLowerCase() === "portlist") {
            if (device.interfaces && device.interfaces.length > 0) {
              const interfaceList = device.interfaces
                .map(
                  (iface, index) =>
                    `${index + 1}. ${iface.ifName} (${iface.ifDescr})`,
                )
                .join("\n");
              reply.text = `*Daftar Port untuk ${device.name}:*\n-----------------------------------\n${interfaceList}`;
            } else {
              reply.text = `Tidak ada port yang ditemukan untuk perangkat ${device.name}.`;
            }
          } else {
            // Request for a specific interface
            const interfaceName = detail;
            const iface = device.interfaces.find(
              (i) =>
                i.ifName?.toLowerCase().includes(interfaceName.toLowerCase()) ||
                i.ifDescr?.toLowerCase().includes(interfaceName.toLowerCase()),
            );

            if (iface) {
              const rx = iface.opticalRx || "N/A";
              const tx = iface.opticalTx || "N/A";
              reply.text = `*Informasi Interface: ${
                iface.ifName
              }*\n-----------------------------------\n*Perangkat:* ${
                device.name
              }\n*Deskripsi:* ${iface.ifDescr || "N/A"}\n*Status:* ${
                iface.ifOperStatus === 1 ? "UP" : "DOWN"
              }\n*Optical RX:* ${rx}\n*Optical TX:* ${tx}`;
            } else {
              reply.text = `Interface dengan nama "${interfaceName}" tidak ditemukan di perangkat ${device.name}.`;
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
          let locationText = "";
          if (device.lat && device.lng) {
            locationText = `*Lokasi:* ${device.popLocation || "N/A"}\n`;
            reply.location = { lat: device.lat, lng: device.lng };
          }

          reply.text = `*Informasi Perangkat: ${ 
            device.name 
          }*\n-----------------------------------\n${locationText}*IP Manajemen:* ${ 
            device.ipMgmt || "N/A"
          }\n*Status:* ${ 
            device.status ? "UP" : "DOWN"
          }\n-----------------------------------\n*Interfaces:*
${interfacesText}`;
        }
      }
    }
  } else if (messageBody === "!domains") {
    const allDomains = await getDomains();
    if (allDomains.length > 0) {
      const domainList = allDomains
        .map((domain, index) => {
          const expiry = domain.expiresAt
            ? new Date(domain.expiresAt).toLocaleDateString("id-ID")
            : "N/A";
          return `${index + 1}. ${domain.name} (berakhir: ${expiry})`;
        })
        .join("\n");
      reply.text = `*Berikut daftar domain yang terdaftar:*
-----------------------------------
${domainList}`;
    } else {
      reply.text = "Tidak ada domain yang terdaftar saat ini.";
    }
  } else if (messageBody.startsWith("!domaininfo")) {
    const arg = messageBody.substring("!domaininfo".length).trim();
    if (!arg) {
      reply.text =
        "Format perintah salah. Gunakan `!domaininfo <nama_domain>`. Ganti <nama_domain> dengan nama domain yang ingin Anda periksa.";
    } else {
      const domain = await getDomainByName(arg);
      if (!domain) {
        reply.text = `Domain dengan nama \"${arg}\" tidak ditemukan.`;
      } else {
        const expiry = domain.expiresAt
          ? new Date(domain.expiresAt).toLocaleString("id-ID")
          : "N/A";
        const updated = domain.updatedAt
          ? new Date(domain.updatedAt).toLocaleString("id-ID")
          : "N/A";
        reply.text = `*Informasi Domain: ${domain.name}*
-----------------------------------
*Status:* ${domain.status || "N/A"}
*Tanggal Kedaluwarsa:* ${expiry}
*Terakhir Diperbarui:* ${updated}`;
      }
    }
  } else if (messageBody === "!menu") {
    reply.text =
      "Berikut menu yang tersedia:\n1. `!devices` - Untuk melihat semua perangkat yang tersedia.\n2. `!deviceinfo <nama perangkat>` - Untuk mendapatkan informasi detail tentang perangkat tertentu.\n3. `!deviceinfo <nama perangkat>.portlist` - Untuk melihat daftar port pada perangkat.\n4. `!deviceinfo <nama perangkat>.<nama interface>` - Untuk melihat detail interface pada perangkat.\n5. `!domains` - Untuk melihat semua domain yang terdaftar.\n6. `!domaininfo <nama domain>` - Untuk mendapatkan informasi detail tentang domain tertentu.";
  }

  return reply;
}
