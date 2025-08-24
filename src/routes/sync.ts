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
  testHuaweiOids,
  testSNMPConnectivity,
  discoverAvailableOids,
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

  // Get timeout from query parameter or use default (8 seconds)
  const snmpTimeout = parseInt((c.req.query("timeout") as string) || "8000");

  // Call services directly
  const nodeResult = await syncNodes(libreNmsCreds, snmpTimeout);
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

  // // Get timeout from query parameter or use default (8 seconds)
  // const snmpTimeout = parseInt((c.req.query("timeout") as string) || "10000");

  const result = await syncNodes(
    {
      url: LIBRENMS_API_URL,
      token: LIBRENMS_API_TOKEN,
    },
    20000,
  );
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
            node.ipMgmt as string,
            node.snmpCommunity as string,
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

syncRouter.post("/test/huawei/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "public";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[TEST] Testing Huawei OIDs for ${ip} with community ${community}`,
    );
    const result = await testHuaweiOids(ip, community);

    return c.json({
      message: "Huawei OID test completed",
      device: ip,
      community: community,
      totalCpuOids: result.cpuOids.length,
      totalRamOids: result.ramOids.length,
      workingOids: result.workingOids,
      recommendations:
        result.workingOids.length > 0
          ? "Found working OIDs! These can be prioritized in the configuration."
          : "No working OIDs found. Check device connectivity and SNMP configuration.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test Huawei OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/test/huawei/ce/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "public";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[CE-TEST] Testing Huawei CE series OIDs for ${ip} with community ${community}`,
    );

    const snmp = require("net-snmp");
    const session = snmp.createSession(ip, community, {
      timeout: 2000,
      retries: 0,
      version: snmp.Version2c,
    });

    const ceOids = {
      cpu: ["1.3.6.1.4.1.2011.6.1.3.2.1.5.1", "1.3.6.1.4.1.2011.6.1.3.2.1.5.2"],
      memoryTotal: [
        "1.3.6.1.4.1.2011.6.1.3.3.1.3.1",
        "1.3.6.1.4.1.2011.6.1.3.3.1.3.2",
      ],
      memoryUsed: [
        "1.3.6.1.4.1.2011.6.1.3.3.1.4.1",
        "1.3.6.1.4.1.2011.6.1.3.3.1.4.2",
      ],
    };

    const results: any = {
      cpu: {},
      memory: {},
      working: [],
    };

    // Test CPU OIDs
    for (const oid of ceOids.cpu) {
      try {
        const result = await new Promise((resolve, reject) => {
          session.get([oid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length > 0 &&
              varbinds[0].value !== null
            ) {
              resolve(varbinds[0].value);
            } else {
              reject(new Error("No data"));
            }
          });
        });
        results.cpu[oid] = { value: result, status: "success" };
        results.working.push(`CPU: ${oid} = ${result}%`);
        console.log(`[CE-TEST] ✅ CPU OID ${oid} = ${result}`);
      } catch (error) {
        results.cpu[oid] = { error: error.message, status: "failed" };
        console.log(`[CE-TEST] ❌ CPU OID ${oid} failed: ${error.message}`);
      }
    }

    // Test Memory OID pairs
    for (let i = 0; i < ceOids.memoryTotal.length; i++) {
      const totalOid = ceOids.memoryTotal[i];
      const usedOid = ceOids.memoryUsed[i];

      try {
        const result = await new Promise((resolve, reject) => {
          session.get([totalOid, usedOid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length === 2 &&
              varbinds[0].value !== null &&
              varbinds[1].value !== null
            ) {
              const total = parseInt(varbinds[0].value.toString());
              const used = parseInt(varbinds[1].value.toString());
              const percentage = total > 0 ? (used / total) * 100 : 0;
              resolve({ total, used, percentage });
            } else {
              reject(new Error("Incomplete data"));
            }
          });
        });

        results.memory[`${totalOid}/${usedOid}`] = {
          value: result,
          status: "success",
        };
        results.working.push(
          `Memory: ${totalOid}/${usedOid} = ${(result as any).percentage.toFixed(2)}%`,
        );
        console.log(
          `[CE-TEST] ✅ Memory pair ${totalOid}/${usedOid} = ${(result as any).percentage.toFixed(2)}%`,
        );
      } catch (error) {
        results.memory[`${totalOid}/${usedOid}`] = {
          error: error.message,
          status: "failed",
        };
        console.log(
          `[CE-TEST] ❌ Memory pair ${totalOid}/${usedOid} failed: ${error.message}`,
        );
      }
    }

    session.close();

    return c.json({
      message: "Huawei CE series OID test completed",
      device: ip,
      community: community,
      results: results,
      summary: {
        workingOids: results.working.length,
        totalTested: ceOids.cpu.length + ceOids.memoryTotal.length,
      },
      recommendations:
        results.working.length > 0
          ? "Found working CE series OIDs! These should be prioritized."
          : "No working CE series OIDs found. Check device model and SNMP configuration.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test CE series OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/test/snmp/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "public";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[SNMP-CONNECTIVITY] Testing SNMP connectivity for ${ip} with community ${community}`,
    );

    const connectivityResult = await testSNMPConnectivity(ip, community);

    return c.json({
      message: "SNMP connectivity test completed",
      device: ip,
      community: community,
      connectivity: connectivityResult.connectivity,
      supportedVersions: connectivityResult.supportedVersions,
      systemInfo: connectivityResult.systemInfo,
      error: connectivityResult.error,
      recommendations: connectivityResult.connectivity
        ? "SNMP connectivity is working. You can proceed with monitoring setup."
        : "SNMP connectivity failed. Check network connectivity, community string, and device SNMP configuration.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test SNMP connectivity: ${error.message}`,
    });
  }
});

syncRouter.post("/test/discover/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "public";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[OID-DISCOVERY] Starting OID discovery for ${ip} with community ${community}`,
    );

    const availableOids = await discoverAvailableOids(ip, community);

    // Filter for CPU and memory related OIDs
    const cpuOids = availableOids.filter(
      (oid) =>
        oid.includes(".5.") || // CPU usage patterns
        oid.includes(".6.") || // CPU dev table
        oid.toLowerCase().includes("cpu"),
    );

    const memoryOids = availableOids.filter(
      (oid) =>
        oid.includes(".7.") || // Memory size patterns
        oid.includes(".8.") || // Memory usage patterns
        oid.includes(".2.") || // Memory total
        oid.includes(".3.") || // Memory used
        oid.toLowerCase().includes("mem"),
    );

    return c.json({
      message: "OID discovery completed",
      device: ip,
      community: community,
      summary: {
        totalOids: availableOids.length,
        cpuRelatedOids: cpuOids.length,
        memoryRelatedOids: memoryOids.length,
      },
      cpuOids: cpuOids.slice(0, 20), // Limit to first 20 for readability
      memoryOids: memoryOids.slice(0, 20), // Limit to first 20 for readability
      allOids:
        availableOids.length > 100
          ? availableOids.slice(0, 100)
          : availableOids,
      recommendations:
        availableOids.length > 0
          ? "Found OIDs on device. Check cpuOids and memoryOids arrays for monitoring candidates."
          : "No OIDs discovered. Check SNMP configuration and network connectivity.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to discover OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/test/basic/:ip", async (c) => {
  const ip = c.req.param("ip");
  const communities = ["public", "laros999", "private", "community"];

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  const snmp = require("net-snmp");
  const results = {
    connectivity: false,
    workingCommunity: null,
    sysDescr: null,
    availableOids: [],
    basicTests: {},
  };

  // Test multiple communities
  for (const community of communities) {
    console.log(`[BASIC-TEST] Testing ${ip} with community: ${community}`);

    try {
      const session = snmp.createSession(ip, community, {
        version: snmp.Version2c,
        timeout: 3000,
        retries: 0,
      });

      // Test sysDescr first
      const sysDescrResult = await new Promise((resolve, reject) => {
        session.get(["1.3.6.1.2.1.1.1.0"], (error: any, varbinds: any[]) => {
          if (error) {
            reject(error);
          } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
            resolve(varbinds[0].value.toString());
          } else {
            reject(new Error("No data"));
          }
        });
      });

      results.connectivity = true;
      results.workingCommunity = community;
      results.sysDescr = sysDescrResult;

      // Test common Huawei OIDs
      const testOids = [
        "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1", // hwEntityCpuUsage
        "1.3.6.1.4.1.2011.2.23.1.2.1.1.2.1", // hwCpuUsage S-series
        "1.3.6.1.4.1.2011.6.3.4.1.2.1", // AR series
      ];

      for (const oid of testOids) {
        try {
          const oidResult = await new Promise((resolve, reject) => {
            session.get([oid], (error: any, varbinds: any[]) => {
              if (error) {
                reject(error);
              } else if (
                varbinds &&
                varbinds.length > 0 &&
                varbinds[0].value !== null
              ) {
                resolve(varbinds[0].value);
              } else {
                reject(new Error("No data"));
              }
            });
          });
          results.availableOids.push({ oid, value: oidResult, type: "CPU" });
        } catch (error) {
          // OID not available, continue
        }
      }

      session.close();
      break; // Found working community, exit loop
    } catch (error) {
      results.basicTests[community] = `Failed: ${error.message}`;
      console.log(
        `[BASIC-TEST] Community ${community} failed: ${error.message}`,
      );
    }
  }

  return c.json({
    message: "Basic SNMP test completed",
    device: ip,
    results,
    recommendations: results.connectivity
      ? `Working community: ${results.workingCommunity}. Device type detected from sysDescr.`
      : "No working SNMP community found. Check device SNMP configuration.",
  });
});

syncRouter.post("/test/huawei/ce6860/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "laros999";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[CE6860-TEST] Testing Huawei CE6860 OIDs for ${ip} with community ${community}`,
    );

    const snmp = require("net-snmp");
    const session = snmp.createSession(ip, community, {
      timeout: 5000,
      retries: 0,
      version: snmp.Version2c,
    });

    const ce6860Oids = {
      cpu: [
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108867", // Main board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108868", // Alt board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1", // Generic index 1
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.2", // Generic index 2
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.9", // Management
      ],
      memoryTotal: [
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108867", // Main board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108868", // Alt board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.1", // Generic index 1
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.2", // Generic index 2
      ],
      memoryUsed: [
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.67108867", // Main board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.67108868", // Alt board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.1", // Generic index 1
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.2", // Generic index 2
      ],
    };

    const results: any = {
      cpu: {},
      memory: {},
      working: [],
      deviceInfo: null,
    };

    // Get device info first
    try {
      const sysDescr = await new Promise((resolve, reject) => {
        session.get(["1.3.6.1.2.1.1.1.0"], (error: any, varbinds: any[]) => {
          if (error) {
            reject(error);
          } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
            resolve(varbinds[0].value.toString());
          } else {
            reject(new Error("No data"));
          }
        });
      });
      results.deviceInfo = sysDescr;
    } catch (error) {
      results.deviceInfo = "Failed to get device info";
    }

    // Test CPU OIDs
    for (const oid of ce6860Oids.cpu) {
      try {
        const result = await new Promise((resolve, reject) => {
          session.get([oid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length > 0 &&
              varbinds[0].value !== null
            ) {
              resolve(varbinds[0].value);
            } else {
              reject(new Error("No data"));
            }
          });
        });
        results.cpu[oid] = { value: result, status: "success" };
        results.working.push(`CPU: ${oid} = ${result}%`);
        console.log(`[CE6860-TEST] ✅ CPU OID ${oid} = ${result}`);
      } catch (error) {
        results.cpu[oid] = { error: error.message, status: "failed" };
        console.log(`[CE6860-TEST] ❌ CPU OID ${oid} failed: ${error.message}`);
      }
    }

    // Test Memory OID pairs
    for (let i = 0; i < ce6860Oids.memoryTotal.length; i++) {
      const totalOid = ce6860Oids.memoryTotal[i];
      const usedOid = ce6860Oids.memoryUsed[i];

      try {
        const result = await new Promise((resolve, reject) => {
          session.get([totalOid, usedOid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length === 2 &&
              varbinds[0].value !== null &&
              varbinds[1].value !== null
            ) {
              const total = parseInt(varbinds[0].value.toString());
              const used = parseInt(varbinds[1].value.toString());
              const percentage = total > 0 ? (used / total) * 100 : 0;

              // Format values for display
              let displayInfo: any = { total, used, percentage };
              if (total > 1000000000) {
                // Values in bytes, convert to GB for display
                displayInfo.totalGB = (total / 1024 / 1024 / 1024).toFixed(2);
                displayInfo.usedGB = (used / 1024 / 1024 / 1024).toFixed(2);
              }

              resolve(displayInfo);
            } else {
              reject(new Error("Incomplete data"));
            }
          });
        });

        results.memory[`${totalOid}/${usedOid}`] = {
          value: result,
          status: "success",
        };
        results.working.push(
          `Memory: ${totalOid}/${usedOid} = ${(result as any).percentage.toFixed(2)}%`,
        );
        console.log(
          `[CE6860-TEST] ✅ Memory pair ${totalOid}/${usedOid} = ${(result as any).percentage.toFixed(2)}%`,
        );
      } catch (error) {
        results.memory[`${totalOid}/${usedOid}`] = {
          error: error.message,
          status: "failed",
        };
        console.log(
          `[CE6860-TEST] ❌ Memory pair ${totalOid}/${usedOid} failed: ${error.message}`,
        );
      }
    }

    session.close();

    return c.json({
      message: "Huawei CE6860 OID test completed",
      device: ip,
      community: community,
      deviceInfo: results.deviceInfo,
      results: results,
      summary: {
        workingOids: results.working.length,
        totalTested: ce6860Oids.cpu.length + ce6860Oids.memoryTotal.length,
      },
      recommendations:
        results.working.length > 0
          ? "Found working CE6860 OIDs! These should be used for monitoring."
          : "No working CE6860 OIDs found. Check SNMP configuration and device access.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test CE6860 OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/discover/huawei/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "laros999";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[HUAWEI-DISCOVERY] Starting comprehensive discovery for ${ip}`,
    );

    const snmp = require("net-snmp");
    const session = snmp.createSession(ip, community, {
      timeout: 10000,
      retries: 0,
      version: snmp.Version2c,
    });

    const results = {
      deviceInfo: null,
      huaweiOids: [],
      cpuCandidates: [],
      memoryCandidates: [],
      standardOids: {},
    };

    // Get device info
    try {
      const sysDescr = await new Promise((resolve, reject) => {
        session.get(["1.3.6.1.2.1.1.1.0"], (error: any, varbinds: any[]) => {
          if (error) reject(error);
          else if (varbinds && varbinds[0].value)
            resolve(varbinds[0].value.toString());
          else reject(new Error("No data"));
        });
      });
      results.deviceInfo = sysDescr;
    } catch (error) {
      results.deviceInfo = "Failed to get device info";
    }

    // Test standard Host Resources MIB
    const standardTests = [
      { oid: "1.3.6.1.2.1.25.3.3.1.2.1", name: "hrProcessorLoad.1" },
      { oid: "1.3.6.1.2.1.25.3.3.1.2.2", name: "hrProcessorLoad.2" },
      { oid: "1.3.6.1.2.1.25.2.3.1.5.1", name: "hrStorageSize.1" },
      { oid: "1.3.6.1.2.1.25.2.3.1.6.1", name: "hrStorageUsed.1" },
      { oid: "1.3.6.1.2.1.25.2.3.1.5.2", name: "hrStorageSize.2" },
      { oid: "1.3.6.1.2.1.25.2.3.1.6.2", name: "hrStorageUsed.2" },
    ];

    for (const test of standardTests) {
      try {
        const result = await new Promise((resolve, reject) => {
          session.get([test.oid], (error: any, varbinds: any[]) => {
            if (error) reject(error);
            else if (varbinds && varbinds[0].value !== null)
              resolve(varbinds[0].value);
            else reject(new Error("No data"));
          });
        });
        results.standardOids[test.name] = { oid: test.oid, value: result };
      } catch (error) {
        // OID not available
      }
    }

    // Discover Huawei OIDs by walking specific branches
    const huaweiBranches = [
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1", // hwEntity
      "1.3.6.1.4.1.2011.6.3", // AR series
      "1.3.6.1.4.1.2011.2.23", // S series
      "1.3.6.1.4.1.2011.6.139", // CPU dev table
      "1.3.6.1.4.1.2011.10.2.6", // System
    ];

    let totalOidsFound = 0;
    for (const branch of huaweiBranches) {
      try {
        const branchOids = await new Promise<string[]>((resolve) => {
          const foundOids: string[] = [];
          session.walk(
            branch,
            (varbinds: any[]) => {
              varbinds.forEach((varbind) => {
                foundOids.push(varbind.oid);
                totalOidsFound++;

                // Check if this looks like CPU or memory OID
                const oid = varbind.oid;
                if (
                  oid.includes(".5.") ||
                  oid.includes(".6.") ||
                  oid.toLowerCase().includes("cpu")
                ) {
                  results.cpuCandidates.push({
                    oid: oid,
                    value: varbind.value,
                  });
                }
                if (
                  oid.includes(".7.") ||
                  oid.includes(".8.") ||
                  oid.includes(".2.") ||
                  oid.includes(".3.")
                ) {
                  results.memoryCandidates.push({
                    oid: oid,
                    value: varbind.value,
                  });
                }
              });
            },
            (error) => {
              resolve(foundOids);
            },
          );

          // Timeout after 5 seconds per branch
          setTimeout(() => resolve(foundOids), 5000);
        });

        results.huaweiOids.push(...branchOids);
      } catch (error) {
        console.log(`Failed to walk ${branch}: ${error.message}`);
      }
    }

    session.close();

    return c.json({
      message: "Huawei OID discovery completed",
      device: ip,
      community: community,
      deviceInfo: results.deviceInfo,
      summary: {
        totalHuaweiOids: results.huaweiOids.length,
        cpuCandidates: results.cpuCandidates.length,
        memoryCandidates: results.memoryCandidates.length,
        standardOids: Object.keys(results.standardOids).length,
      },
      standardOids: results.standardOids,
      cpuCandidates: results.cpuCandidates.slice(0, 10),
      memoryCandidates: results.memoryCandidates.slice(0, 10),
      allHuaweiOids: results.huaweiOids.slice(0, 50),
      recommendations:
        Object.keys(results.standardOids).length > 0
          ? "Standard Host Resources MIB OIDs found. These should work for monitoring."
          : results.cpuCandidates.length > 0 ||
              results.memoryCandidates.length > 0
            ? "Found Huawei-specific OIDs. Check cpuCandidates and memoryCandidates."
            : "No suitable monitoring OIDs found. Check device SNMP configuration.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to discover Huawei OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/walk/huawei/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "laros999";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[HUAWEI-WALK] Starting systematic walk for ${ip} with community ${community}`,
    );

    const snmp = require("net-snmp");
    const session = snmp.createSession(ip, community, {
      timeout: 10000,
      retries: 0,
      version: snmp.Version2c,
    });

    const results = {
      deviceInfo: null,
      branches: {},
      potentialCpuOids: [],
      potentialMemoryOids: [],
      allOids: [],
    };

    // Get device info
    try {
      const sysDescr = await new Promise((resolve, reject) => {
        session.get(["1.3.6.1.2.1.1.1.0"], (error: any, varbinds: any[]) => {
          if (error) reject(error);
          else if (varbinds && varbinds[0].value)
            resolve(varbinds[0].value.toString());
          else reject(new Error("No data"));
        });
      });
      results.deviceInfo = sysDescr;
    } catch (error) {
      results.deviceInfo = "Failed to get device info";
    }

    // Walk specific Huawei branches systematically
    const branches = [
      { name: "hwEntity", oid: "1.3.6.1.4.1.2011.5.25.31" },
      { name: "hwCustom", oid: "1.3.6.1.4.1.2011.5.2" },
      { name: "hwCE", oid: "1.3.6.1.4.1.2011.6.1.3" },
      { name: "hwSystem", oid: "1.3.6.1.4.1.2011.10.2.6" },
      { name: "hwCpuDev", oid: "1.3.6.1.4.1.2011.6.139.2.6" },
      { name: "hwSeries", oid: "1.3.6.1.4.1.2011.2.23" },
      { name: "hwAR", oid: "1.3.6.1.4.1.2011.6.3" },
    ];

    for (const branch of branches) {
      console.log(
        `[HUAWEI-WALK] Walking branch: ${branch.name} (${branch.oid})`,
      );

      try {
        const branchResults = await new Promise<any[]>((resolve) => {
          const foundOids: any[] = [];
          session.walk(
            branch.oid,
            (varbinds: any[]) => {
              varbinds.forEach((varbind) => {
                const oidInfo = {
                  oid: varbind.oid,
                  value: varbind.value,
                  type: varbind.type,
                  branch: branch.name,
                };
                foundOids.push(oidInfo);
                results.allOids.push(oidInfo);

                // Analyze for CPU patterns
                if (
                  varbind.oid.includes(".5.") ||
                  varbind.oid.includes(".6.") ||
                  (varbind.value &&
                    typeof varbind.value === "number" &&
                    varbind.value <= 100 &&
                    varbind.value >= 0)
                ) {
                  results.potentialCpuOids.push(oidInfo);
                }

                // Analyze for Memory patterns
                if (
                  varbind.oid.includes(".7.") ||
                  varbind.oid.includes(".8.") ||
                  varbind.oid.includes(".2.") ||
                  varbind.oid.includes(".3.") ||
                  (varbind.value &&
                    typeof varbind.value === "number" &&
                    varbind.value > 1000)
                ) {
                  results.potentialMemoryOids.push(oidInfo);
                }
              });
            },
            (error) => {
              resolve(foundOids);
            },
          );

          // Timeout after 8 seconds per branch
          setTimeout(() => resolve(foundOids), 8000);
        });

        results.branches[branch.name] = {
          oid: branch.oid,
          count: branchResults.length,
          samples: branchResults.slice(0, 5),
        };

        console.log(
          `[HUAWEI-WALK] Branch ${branch.name}: ${branchResults.length} OIDs found`,
        );
      } catch (error) {
        console.log(
          `[HUAWEI-WALK] Failed to walk ${branch.name}: ${error.message}`,
        );
        results.branches[branch.name] = {
          oid: branch.oid,
          error: error.message,
          count: 0,
        };
      }
    }

    session.close();

    return c.json({
      message: "Huawei systematic walk completed",
      device: ip,
      community: community,
      deviceInfo: results.deviceInfo,
      summary: {
        totalOids: results.allOids.length,
        potentialCpuOids: results.potentialCpuOids.length,
        potentialMemoryOids: results.potentialMemoryOids.length,
        branchesScanned: Object.keys(results.branches).length,
      },
      branches: results.branches,
      topCpuCandidates: results.potentialCpuOids.slice(0, 10),
      topMemoryCandidates: results.potentialMemoryOids.slice(0, 10),
      recommendations:
        results.potentialCpuOids.length > 0 ||
        results.potentialMemoryOids.length > 0
          ? "Found potential monitoring OIDs. Check topCpuCandidates and topMemoryCandidates for usable OIDs."
          : "No suitable monitoring OIDs found in common Huawei branches. This device may use a different MIB structure.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to walk Huawei OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/test/huawei/ce6860/verified/:ip", async (c) => {
  const ip = c.req.param("ip");
  const community = c.req.query("community") || "laros999";

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  try {
    console.log(
      `[CE6860-VERIFIED-TEST] Testing confirmed working OIDs for ${ip}`,
    );

    const snmp = require("net-snmp");
    const session = snmp.createSession(ip, community, {
      timeout: 8000,
      retries: 0,
      version: snmp.Version2c,
    });

    const verifiedOids = {
      cpu: [
        "1.3.6.1.4.1.2011.6.3.4.1.2.1.1.0", // CONFIRMED: Returns 11%
        "1.3.6.1.4.1.2011.6.3.4.1.3.1.1.0", // CONFIRMED: Returns 10%
        "1.3.6.1.4.1.2011.6.3.4.1.4.1.1.0", // CONFIRMED: Returns 10%
      ],
      memoryTotal: ["1.3.6.1.4.1.2011.6.3.5.1.1.2.1.1.0"], // CONFIRMED: Returns 2033782784 bytes
      memoryUsed: ["1.3.6.1.4.1.2011.6.3.5.1.1.3.1.1.0"], // CONFIRMED: Returns 973664256 bytes
    };

    const results: any = {
      cpu: {},
      memory: {},
      working: [],
      deviceInfo: null,
    };

    // Get device info
    try {
      const sysDescr = await new Promise((resolve, reject) => {
        session.get(["1.3.6.1.2.1.1.1.0"], (error: any, varbinds: any[]) => {
          if (error) {
            reject(error);
          } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
            resolve(varbinds[0].value.toString());
          } else {
            reject(new Error("No data"));
          }
        });
      });
      results.deviceInfo = sysDescr;
    } catch (error) {
      results.deviceInfo = "Failed to get device info";
    }

    // Test verified CPU OIDs
    for (const oid of verifiedOids.cpu) {
      try {
        const result = await new Promise((resolve, reject) => {
          session.get([oid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length > 0 &&
              varbinds[0].value !== null
            ) {
              resolve(varbinds[0].value);
            } else {
              reject(new Error("No data"));
            }
          });
        });
        results.cpu[oid] = { value: result, status: "success" };
        results.working.push(`CPU: ${oid} = ${result}%`);
        console.log(`[CE6860-VERIFIED-TEST] ✅ CPU OID ${oid} = ${result}%`);
      } catch (error) {
        results.cpu[oid] = { error: error.message, status: "failed" };
        console.log(
          `[CE6860-VERIFIED-TEST] ❌ CPU OID ${oid} failed: ${error.message}`,
        );
      }
    }

    // Test verified Memory OID pair
    const totalOid = verifiedOids.memoryTotal[0];
    const usedOid = verifiedOids.memoryUsed[0];

    try {
      const result = await new Promise((resolve, reject) => {
        session.get([totalOid, usedOid], (error: any, varbinds: any[]) => {
          if (error) {
            reject(error);
          } else if (
            varbinds &&
            varbinds.length === 2 &&
            varbinds[0].value !== null &&
            varbinds[1].value !== null
          ) {
            const total = parseInt(varbinds[0].value.toString());
            const used = parseInt(varbinds[1].value.toString());
            const percentage = total > 0 ? (used / total) * 100 : 0;

            // Format values for display (bytes to GB)
            let displayInfo: any = { total, used, percentage };
            if (total > 1000000000) {
              displayInfo.totalGB = (total / 1024 / 1024 / 1024).toFixed(2);
              displayInfo.usedGB = (used / 1024 / 1024 / 1024).toFixed(2);
            }

            resolve(displayInfo);
          } else {
            reject(new Error("Incomplete data"));
          }
        });
      });

      results.memory[`${totalOid}/${usedOid}`] = {
        value: result,
        status: "success",
      };
      results.working.push(
        `Memory: ${(result as any).usedGB}GB/${(result as any).totalGB}GB = ${(result as any).percentage.toFixed(2)}%`,
      );
      console.log(
        `[CE6860-VERIFIED-TEST] ✅ Memory pair = ${(result as any).percentage.toFixed(2)}% (${(result as any).usedGB}GB/${(result as any).totalGB}GB)`,
      );
    } catch (error) {
      results.memory[`${totalOid}/${usedOid}`] = {
        error: error.message,
        status: "failed",
      };
      console.log(
        `[CE6860-VERIFIED-TEST] ❌ Memory pair failed: ${error.message}`,
      );
    }

    session.close();

    return c.json({
      message: "CE6860 verified OID test completed",
      device: ip,
      community: community,
      deviceInfo: results.deviceInfo,
      results: results,
      summary: {
        workingOids: results.working.length,
        totalTested: verifiedOids.cpu.length + 1, // +1 for memory pair
      },
      workingOids: results.working,
      recommendations:
        results.working.length > 0
          ? `SUCCESS! Found ${results.working.length} working OIDs. These should be used for CE6860 monitoring.`
          : "FAILED: No verified OIDs working. Check device connectivity and SNMP configuration.",
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test verified CE6860 OIDs: ${error.message}`,
    });
  }
});

syncRouter.post("/debug/sync/:ip", async (c) => {
  const ip = c.req.param("ip");
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!ip) {
    throw new HTTPException(400, {
      message: "IP address is required",
    });
  }

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  try {
    console.log(`[SYNC-DEBUG] Debugging sync configuration for ${ip}`);

    // Fetch device info from LibreNMS
    const response = await fetch(`${LIBRENMS_API_URL}/devices`, {
      headers: { "X-Auth-Token": LIBRENMS_API_TOKEN },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new HTTPException(500, {
        message: `Failed to fetch from LibreNMS: ${errorText}`,
      });
    }

    const data = await response.json();
    const targetDevice = data.devices.find((device: any) => device.ip === ip);

    if (!targetDevice) {
      return c.json({
        message: `Device ${ip} not found in LibreNMS`,
        found: false,
      });
    }

    console.log(
      `[SYNC-DEBUG] Found device in LibreNMS:`,
      JSON.stringify(targetDevice, null, 2),
    );

    // Test SNMP with LibreNMS community
    const snmp = require("net-snmp");
    const librenmsSession = snmp.createSession(ip, targetDevice.community, {
      timeout: 8000,
      retries: 0,
      version: snmp.Version2c,
    });

    const testOids = [
      "1.3.6.1.4.1.2011.6.3.4.1.2.1.1.0", // CPU
      "1.3.6.1.4.1.2011.6.3.5.1.1.2.1.1.0", // Memory Total
      "1.3.6.1.4.1.2011.6.3.5.1.1.3.1.1.0", // Memory Used
    ];

    const snmpResults = {};

    for (const oid of testOids) {
      try {
        const result = await new Promise((resolve, reject) => {
          librenmsSession.get([oid], (error: any, varbinds: any[]) => {
            if (error) {
              reject(error);
            } else if (
              varbinds &&
              varbinds.length > 0 &&
              varbinds[0].value !== null
            ) {
              resolve(varbinds[0].value);
            } else {
              reject(new Error("No data"));
            }
          });
        });
        snmpResults[oid] = { value: result, status: "success" };
      } catch (error) {
        snmpResults[oid] = { error: error.message, status: "failed" };
      }
    }

    librenmsSession.close();

    return c.json({
      message: "Sync debug completed",
      device: ip,
      librenmsDevice: {
        community: targetDevice.community,
        sysName: targetDevice.sysName,
        hostname: targetDevice.hostname,
        status: targetDevice.status,
        os: targetDevice.os,
      },
      snmpResults: snmpResults,
      comparison: {
        manualTestCommunity: "laros999",
        librenmsoCommunity: targetDevice.community,
        communityMatch: targetDevice.community === "laros999",
      },
      recommendations:
        targetDevice.community === "laros999"
          ? "Community strings match. Issue might be elsewhere."
          : `Community mismatch! LibreNMS uses '${targetDevice.community}' but manual test used 'laros999'. Update LibreNMS or test with correct community.`,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to debug sync configuration: ${error.message}`,
    });
  }
});

export default syncRouter;
