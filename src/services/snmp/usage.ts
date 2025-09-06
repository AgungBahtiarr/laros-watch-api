import * as snmp from "net-snmp";
import * as fs from "fs";
import * as path from "path";

// Function to discover available storage indices
const discoverStorageIndices = (
  ipAddress: string,
  community: string,
): Promise<number[]> => {
  return new Promise((resolve) => {
    const session = snmp.createSession(ipAddress, community, {
      timeout: 2000,
      retries: 0,
    });

    const storageTypeOid = "1.3.6.1.2.1.25.2.3.1.2"; // hrStorageType
    const indices: number[] = [];

    session.subtree(
      storageTypeOid,
      (varbinds: any) => {
        varbinds.forEach((vb: any) => {
          // Look for RAM storage types
          const oidParts = vb.oid.split(".");
          const index = parseInt(oidParts[oidParts.length - 1]);
          if (!isNaN(index)) {
            indices.push(index);
          }
        });
      },
      (error: any) => {
        session.close();
        if (error) {
          console.warn(
            `Storage discovery failed for ${ipAddress}: ${error.message}`,
          );
          // Return common indices as fallback
          resolve([1, 2, 3, 4, 5]);
        } else {
          resolve(indices.length > 0 ? indices : [1, 2, 3, 4, 5]);
        }
      },
    );
  });
};

const getOidsForVendor = (vendor: string) => {
  const basePath = path.join(__dirname, "..", "..", "config");
  let vendorPath = "";

  switch (vendor) {
    case "mikrotik":
      vendorPath = "routeros";
      break;
    case "juniper":
      vendorPath = "junos";
      break;
    case "huawei":
      vendorPath = "vrp";
      break;
    default:
      vendorPath = "generic";
  }

  const filePath = path.join(basePath, vendorPath, "oids.json");
  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(fileContent);
  }

  // Fallback to generic if vendor-specific file doesn't exist
  const genericFilePath = path.join(basePath, "generic", "oids.json");
  if (fs.existsSync(genericFilePath)) {
    const fileContent = fs.readFileSync(genericFilePath, "utf-8");
    return JSON.parse(fileContent);
  }

  return { cpu: [], ram: { total: [], used: [] } };
};

// Function to determine device vendor based on OS string
export const getDeviceVendor = (os: string): string => {
  if (!os) return "generic";

  const osLower = os.toLowerCase();

  // MikroTik detection
  if (
    osLower.includes("mikrotik") ||
    osLower.includes("routeros") ||
    osLower.includes("router os") ||
    osLower.includes("mt")
  ) {
    return "mikrotik";
  }

  // Juniper detection
  if (
    osLower.includes("junos") ||
    osLower.includes("juniper") ||
    osLower.includes("srx") ||
    osLower.includes("ex") ||
    osLower.includes("mx")
  ) {
    return "juniper";
  }

  // Huawei detection
  if (
    osLower.includes("huawei") ||
    osLower.includes("vrp") ||
    osLower.includes("versatile routing platform") ||
    osLower.includes("cloudengine") ||
    osLower.includes("ce")
  ) {
    return "huawei";
  }

  // Cisco detection (add as generic with specific patterns)
  if (
    osLower.includes("cisco") ||
    osLower.includes("ios") ||
    osLower.includes("nexus") ||
    osLower.includes("catalyst")
  ) {
    return "cisco";
  }

  // HP/HPE detection
  if (
    osLower.includes("hp ") ||
    osLower.includes("hpe") ||
    osLower.includes("procurve") ||
    osLower.includes("aruba")
  ) {
    return "hp";
  }

  return "generic";
};

export const fetchCpuUsage = (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const oids = getOidsForVendor(vendor);
    const cpuOids = Array.isArray(oids.cpu) ? oids.cpu : [oids.cpu];

    if (cpuOids.length === 0) {
      return resolve(null);
    }

    console.log(
      `[OID-TEST] Batch testing ${cpuOids.length} CPU OIDs for ${ipAddress} (vendor: ${vendor})`,
    );

    const session = snmp.createSession(ipAddress, community, {
      timeout: 8000,
      retries: 0,
      version: snmp.Version2c,
    });

    session.get(cpuOids, (error, varbinds) => {
      session.close();
      if (error) {
        const errorMessage = `SNMP session error for ${ipAddress}: ${error.message || error}`;
        console.error(`[OID-ERROR] ${errorMessage}`);
        return reject(new Error(errorMessage));
      }

      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) {
          continue;
        }
        try {
          if (varbind.value !== null && varbind.value !== undefined) {
            let cpuUsage = parseInt(varbind.value.toString());
            const rawValue = cpuUsage;
            const oid = varbind.oid;

            if (vendor === "juniper") {
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (vendor === "mikrotik") {
              if (oid.includes("14988.1.1.3.14")) {
                cpuUsage = Math.min(
                  100,
                  Math.max(0, Math.round((cpuUsage * 100) / 255)),
                );
                console.log(
                  `[DEBUG] MikroTik ${ipAddress} - Converted CPU from 0-255 scale: ${rawValue} -> ${cpuUsage}%`,
                );
              } else if (oid.includes("1.3.6.1.2.1.25.3.3.1.2")) {
                if (cpuUsage > 100) {
                  cpuUsage = Math.min(100, Math.max(0, cpuUsage / 100));
                  console.log(
                    `[DEBUG] MikroTik ${ipAddress} - Scaled CPU from centipercent: ${rawValue} -> ${cpuUsage}%`,
                  );
                } else {
                  cpuUsage = Math.min(100, Math.max(0, cpuUsage));
                }
              } else {
                cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              }
            } else {
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            }

            console.log(
              `[OID-SUCCESS] CPU OID SUCCESSFUL: ${oid} for ${ipAddress} (vendor: ${vendor}) - Result: ${cpuUsage}%`,
            );
            return resolve(cpuUsage);
          }
        } catch (parseError) {
          // Continue
        }
      }

      console.error(
        `[OID-SUMMARY] ALL CPU OIDs FAILED for ${ipAddress} (vendor: ${vendor})`,
      );
      resolve(null);
    });
  });
};

export const fetchRamUsage = (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise(async (resolve, reject) => {
    const oids = getOidsForVendor(vendor);
    let totalOids = Array.isArray(oids.ram.total)
      ? oids.ram.total
      : [oids.ram.total];
    let usedOids = Array.isArray(oids.ram.used)
      ? oids.ram.used
      : [oids.ram.used];

    if (vendor === "generic") {
      try {
        const indices = await discoverStorageIndices(ipAddress, community);
        const dynamicTotalOids = indices.map(
          (idx) => `1.3.6.1.2.1.25.2.3.1.5.${idx}`,
        );
        const dynamicUsedOids = indices.map(
          (idx) => `1.3.6.1.2.1.25.2.3.1.6.${idx}`,
        );
        totalOids = [...totalOids, ...dynamicTotalOids];
        usedOids = [...usedOids, ...dynamicUsedOids];
      } catch (error) {
        console.warn(
          `[OID-INFO] Storage discovery failed for ${ipAddress}, using static OIDs.`,
        );
      }
    }

    const allOids = [...new Set([...totalOids, ...usedOids])];

    if (allOids.length === 0) {
      return resolve(null);
    }

    console.log(
      `[OID-TEST] ⚡️ Batch testing ${allOids.length} RAM OIDs for ${ipAddress} (vendor: ${vendor})`,
    );

    const session = snmp.createSession(ipAddress, community, {
      timeout: 8000,
      retries: 0,
      version: snmp.Version2c,
    });

    session.get(allOids, (error, varbinds) => {
      session.close();
      if (error) {
        const errorMessage = `SNMP session error for ${ipAddress}: ${error.message || error}`;
        console.error(`[OID-ERROR] ${errorMessage}`);
        return reject(new Error(errorMessage));
      }

      const resultMap = new Map<string, number>();
      for (const varbind of varbinds) {
        if (
          !snmp.isVarbindError(varbind) &&
          varbind.value !== null &&
          varbind.value !== undefined
        ) {
          try {
            resultMap.set(varbind.oid, parseInt(varbind.value.toString()));
          } catch (e) {
            /* ignore */
          }
        }
      }

      if (resultMap.size === 0) {
        console.error(
          `[OID-SUMMARY] No valid RAM OIDs returned for ${ipAddress}`,
        );
        return resolve(null);
      }

      for (const totalOid of totalOids) {
        for (const usedOid of usedOids) {
          if (resultMap.has(totalOid) && resultMap.has(usedOid)) {
            let totalRam = resultMap.get(totalOid)!;
            let usedRam = resultMap.get(usedOid)!;

            if (vendor === "mikrotik") {
              if (usedOid.includes("14988.1.1.1.1")) {
                usedRam = totalRam - usedRam;
              }
              if (totalRam < 1024) {
                totalRam *= 1024 * 1024;
                usedRam *= 1024 * 1024;
              }
            }

            if (totalRam > 0) {
              const ramUsagePercent = (usedRam / totalRam) * 100;
              const finalUsage = Math.min(
                100,
                Math.max(0, Math.round(ramUsagePercent * 100) / 100),
              );
              console.log(
                `[OID-SUCCESS] RAM OIDs SUCCESSFUL: Total=${totalOid}, Used=${usedOid} for ${ipAddress} - Result: ${finalUsage}%`,
              );
              return resolve(finalUsage);
            }
          }
        }
      }

      console.error(
        `[OID-SUMMARY] Could not find a working RAM OID pair for ${ipAddress}`,
      );
      resolve(null);
    });
  });
};

// Function to fetch both CPU and RAM usage
export const fetchSystemUsage = async (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<{ cpuUsage: number | null; ramUsage: number | null }> => {
  console.log(
    `[SYSTEM-USAGE] Starting system usage monitoring for ${ipAddress} (vendor: ${vendor})`,
  );
  try {
    // Run sequentially instead of in parallel to reduce load on device
    const cpuUsage = await fetchCpuUsage(ipAddress, community, vendor);
    const ramUsage = await fetchRamUsage(ipAddress, community, vendor);

    console.log(
      `[SYSTEM-USAGE] Completed system usage monitoring for ${ipAddress} (vendor: ${vendor}) - CPU: ${cpuUsage}%, RAM: ${ramUsage}%`,
    );

    return { cpuUsage, ramUsage };
  } catch (error) {
    console.error(
      `[SYSTEM-USAGE] ❌ Error fetching system usage for ${ipAddress} (vendor: ${vendor}):`,
      error,
    );
    return { cpuUsage: null, ramUsage: null };
  }
};
