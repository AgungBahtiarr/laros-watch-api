import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { lldp } from "@/db/schema";
import eventBus from "@/utils/event-bus";
import { syncNodes, syncInterfaces } from "@/services/sync";
import { sendChangeNotification } from "@/services/notification";
import {
  fetchAndProcessLldpData,
  clearExpiredCache,
  getCacheStats,
} from "@/services/snmp";

const syncRouter = new Hono();

syncRouter.post("/transport", async (c) => {
  const {
    WA_GROUP_ID,
    WA_API_URL,
    WA_USERNAME,
    WA_PASSWORD,
    LIBRENMS_API_URL,
    LIBRENMS_API_TOKEN,
  } = env<{
    WA_API_URL: string;
    WA_GROUP_ID: string;
    WA_USERNAME: string;
    WA_PASSWORD: string;
    LIBRENMS_API_URL: string;
    LIBRENMS_API_TOKEN: string;
  }>(c);

  console.log("Running sync to generate notification...");

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const libreNmsCreds = { url: LIBRENMS_API_URL, token: LIBRENMS_API_TOKEN };

  // Call services directly
  const nodeResult = await syncNodes(libreNmsCreds);
  const interfaceResult = await syncInterfaces(libreNmsCreds);

  const nodeChanges = nodeResult.changes || [];
  const interfaceChanges = interfaceResult.changes || [];

  // Emit event to update clients
  eventBus.emit("db-updated", { nodeChanges, interfaceChanges });
  console.log("Event 'db-updated' emitted.");

  const whatsappCreds = {
    apiUrl: WA_API_URL,
    groupId: WA_GROUP_ID,
    username: WA_USERNAME,
    password: WA_PASSWORD,
  };

  const notificationResult = await sendChangeNotification(whatsappCreds, {
    nodeChanges,
    interfaceChanges,
  });

  return c.json(notificationResult);
});

syncRouter.post("/sync", async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const result = await syncNodes({
    url: LIBRENMS_API_URL,
    token: LIBRENMS_API_TOKEN,
  });
  return c.json(result);
});

syncRouter.post("/lldp/sync", async (c) => {
  const allNodes = await db.query.nodes.findMany();

  if (!allNodes || allNodes.length === 0) {
    return c.json({ message: "No nodes found in the database." });
  }

  const allInterfaces = await db.query.interfaces.findMany();
  const interfaceMap = new Map(
    allInterfaces.map((iface) => [
      `${iface.nodeId}-${iface.ifIndex}`,
      iface.ifDescr,
    ]),
  );

  let successfulDevices = 0;
  let failedDevices = 0;

  try {
    const allLldpData = await Promise.all(
      allNodes.map(async (node) => {
        try {
          const lldpData = await fetchAndProcessLldpData(
            node.ipMgmt,
            node.snmpCommunity,
          );
          successfulDevices++;
          return { nodeId: node.id, nodeName: node.name, data: lldpData };
        } catch (error) {
          failedDevices++;
          console.error(
            `Failed to fetch LLDP data for node ${node.name}:`,
            error,
          );
          return { nodeId: node.id, nodeName: node.name, data: [] }; // Return empty data on error
        }
      }),
    );

    const valuesToUpsert = allLldpData.flatMap(({ nodeId, nodeName, data }) =>
      data.map((entry) => ({
        ...entry,
        nodeId,
        localDeviceName: nodeName,
        localPortDescription: interfaceMap.get(
          `${nodeId}-${entry.localPortIfIndex}`,
        ),
      })),
    );

    if (valuesToUpsert.length > 0) {
      await db
        .insert(lldp)
        .values(valuesToUpsert)
        .onConflictDoUpdate({
          target: [lldp.nodeId, lldp.localPortIfIndex],
          set: {
            localDeviceName: lldp.localDeviceName,
            localPortDescription: lldp.localPortDescription,
            remoteChassisIdSubtypeCode: lldp.remoteChassisIdSubtypeCode,
            remoteChassisIdSubtypeName: lldp.remoteChassisIdSubtypeName,
            remoteChassisId: lldp.remoteChassisId,
            remotePortIdSubtypeCode: lldp.remotePortIdSubtypeCode,
            remotePortIdSubtypeName: lldp.remotePortIdSubtypeName,
            remotePortId: lldp.remotePortId,
            remotePortDescription: lldp.remotePortDescription,
            remoteSystemName: lldp.remoteSystemName,
            remoteSystemDescription: lldp.remoteSystemDescription,
            updatedAt: new Date(),
          },
        });
    }

    return c.json({
      message: "LLDP sync completed successfully.",
      successfulDevices,
      failedDevices,
      syncedCount: valuesToUpsert.length,
      data: valuesToUpsert,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to sync LLDP data: ${error.message}`,
    });
  }
});

syncRouter.post("/sync/interfaces", async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const result = await syncInterfaces({
    url: LIBRENMS_API_URL,
    token: LIBRENMS_API_TOKEN,
  });
  return c.json(result);
});

syncRouter.get("/cache/stats", async (c) => {
  try {
    const stats = getCacheStats();
    return c.json({
      message: "SNMP OID cache statistics",
      ...stats,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to get cache stats: ${error.message}`,
    });
  }
});

syncRouter.post("/cache/clear", async (c) => {
  try {
    clearExpiredCache();
    const stats = getCacheStats();
    return c.json({
      message: "Expired cache entries cleared successfully",
      ...stats,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to clear cache: ${error.message}`,
    });
  }
});

syncRouter.get("/debug/:ip", async (c) => {
  const ipAddress = c.req.param("ip");
  const { community = "public", vendor = "generic" } = c.req.query();

  if (!ipAddress) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(`[DEBUG] Testing SNMP for ${ipAddress} with vendor: ${vendor}`);

    // Import required functions
    const { fetchCpuUsage, fetchRamUsage, getDeviceVendor } = await import(
      "@/services/snmp"
    );

    const detectedVendor = vendor === "auto" ? getDeviceVendor("") : vendor;

    const [cpuUsage, ramUsage] = await Promise.all([
      fetchCpuUsage(ipAddress, community, detectedVendor),
      fetchRamUsage(ipAddress, community, detectedVendor),
    ]);

    return c.json({
      message: "Debug SNMP test completed",
      device: {
        ip: ipAddress,
        community: community,
        vendor: detectedVendor,
      },
      results: {
        cpuUsage: cpuUsage,
        ramUsage: ramUsage,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `SNMP debug failed: ${error.message}`,
    });
  }
});

syncRouter.get("/debug/huawei/:ip", async (c) => {
  const ipAddress = c.req.param("ip");
  const { community = "public" } = c.req.query();

  if (!ipAddress) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(`[DEBUG] Testing Huawei SNMP discovery for ${ipAddress}`);

    // Test basic connectivity first
    const snmp = require("net-snmp");
    const session = snmp.createSession(ipAddress, community, {
      timeout: 3000,
      retries: 0,
    });

    // Test various Huawei OIDs
    const testOids = [
      "1.3.6.1.2.1.1.1.0", // sysDescr
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad
      "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize
      "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108867", // hwEntityCpuUsage main
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108867", // hwEntityMemSize main
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.67108867", // hwEntityMemUsage main
    ];

    const results: any = {};

    for (const oid of testOids) {
      try {
        const result = await new Promise((resolve) => {
          session.get([oid], (error: any, varbinds: any) => {
            if (error) {
              resolve({ error: error.message });
            } else if (varbinds && varbinds[0]) {
              resolve({
                value: varbinds[0].value?.toString() || "null",
                type: typeof varbinds[0].value,
              });
            } else {
              resolve({ error: "No data" });
            }
          });
        });
        results[oid] = result;
      } catch (error) {
        results[oid] = { error: "Exception occurred" };
      }
    }

    session.close();

    // Also try discovery
    let discoveredIndices: number[] = [];
    try {
      const { fetchSystemUsage, getDeviceVendor } = await import(
        "@/services/snmp"
      );
      // For now, use default Huawei indices since discovery function is internal
      discoveredIndices = [67108867, 67108868, 1, 2];
    } catch (error: any) {
      console.warn("Discovery failed:", error.message);
    }

    return c.json({
      message: "Huawei SNMP discovery test completed",
      device: {
        ip: ipAddress,
        community: community,
      },
      basicOids: results,
      discoveredEntityIndices: discoveredIndices,
      suggestions: {
        "CPU OIDs to try manually": [
          `snmpget -v2c -c ${community} ${ipAddress} 1.3.6.1.2.1.25.3.3.1.2.1`,
          `snmpget -v2c -c ${community} ${ipAddress} 1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108867`,
        ],
        "Memory OIDs to try manually": [
          `snmpget -v2c -c ${community} ${ipAddress} 1.3.6.1.2.1.25.2.3.1.5.1`,
          `snmpget -v2c -c ${community} ${ipAddress} 1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108867`,
        ],
        "Entity discovery": [
          `snmpwalk -v2c -c ${community} ${ipAddress} 1.3.6.1.4.1.2011.5.25.31.1.1.1.1.2`,
        ],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Huawei SNMP discovery failed: ${error.message}`,
    });
  }
});

syncRouter.get("/cache/failed", async (c) => {
  try {
    const { getCacheStats, oidCache } = await import("@/services/snmp");
    const stats = getCacheStats();

    // Get detailed failed OIDs info
    const failedOidsDetails: any = {};

    for (const [key, entry] of oidCache.entries()) {
      if (
        entry.failedOids &&
        (entry.failedOids.cpu.length > 0 ||
          entry.failedOids.ramTotal.length > 0 ||
          entry.failedOids.ramUsed.length > 0)
      ) {
        failedOidsDetails[key] = {
          failedOids: entry.failedOids,
          timestamp: new Date(entry.timestamp).toISOString(),
          isExpired: Date.now() - entry.timestamp >= entry.ttl,
        };
      }
    }

    return c.json({
      message: "Failed OIDs cache information",
      stats: {
        totalFailedOids: stats.totalFailedOids,
        devicesWithFailures: Object.keys(failedOidsDetails).length,
      },
      failedOidsDetails,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to get failed OIDs info: ${error.message}`,
    });
  }
});

syncRouter.post("/cache/clear-failed", async (c) => {
  try {
    // Import required functions
    const { clearExpiredCache, oidCache, getCacheStats } = await import(
      "@/services/snmp"
    );

    // Clear all caches including failed OIDs
    clearExpiredCache();

    // Also manually clear all failed OIDs from active cache entries

    let clearedCount = 0;
    for (const [key, entry] of oidCache.entries()) {
      if (entry.failedOids) {
        const totalBefore =
          entry.failedOids.cpu.length +
          entry.failedOids.ramTotal.length +
          entry.failedOids.ramUsed.length;

        entry.failedOids.cpu = [];
        entry.failedOids.ramTotal = [];
        entry.failedOids.ramUsed = [];

        clearedCount += totalBefore;
      }
    }

    const stats = getCacheStats();

    return c.json({
      message: "Failed OIDs cleared successfully",
      clearedFailedOids: clearedCount,
      ...stats,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to clear failed OIDs: ${error.message}`,
    });
  }
});

export default syncRouter;
