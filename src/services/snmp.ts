import * as snmp from "net-snmp";

// Cache for OID discovery results
export const oidCache = new Map<
  string,
  {
    workingOids: { cpu?: string; ramTotal?: string; ramUsed?: string };
    failedOids: { cpu: string[]; ramTotal: string[]; ramUsed: string[] };
    timestamp: number;
    ttl: number;
  }
>();

// Cache for failed devices to avoid retrying too soon
const failedDeviceCache = new Map<string, { timestamp: number; ttl: number }>();

// Cache TTL: 30 minutes
const CACHE_TTL = 30 * 60 * 1000;
// Failed device cache TTL: 5 minutes
const FAILED_DEVICE_TTL = 5 * 60 * 1000;

// Function to get cache key
const getCacheKey = (ipAddress: string, vendor: string): string => {
  return `${ipAddress}-${vendor}`;
};

// Function to check if cache entry is valid
const isCacheValid = (entry: any): boolean => {
  return Date.now() - entry.timestamp < entry.ttl;
};

const safeToString = (data: any, type = "string") => {
  if (data === undefined || data === null) return null;
  if (Buffer.isBuffer(data)) {
    if (type === "hex")
      return data.length > 0
        ? data
            .toString("hex")
            .match(/.{1,2}/g)
            ?.join(":")
        : null;
    return data.toString();
  }
  return String(data);
};

function getChassisIdSubtypeName(subtype: number) {
  const names: { [key: number]: string } = {
    1: "chassisComponent",
    2: "interfaceAlias",
    3: "portComponent",
    4: "macAddress",
    5: "networkAddress",
    6: "interfaceName",
    7: "local",
  };
  return names[subtype] || `unknown (${subtype})`;
}

function getPortIdSubtypeName(subtype: number) {
  const names: { [key: number]: string } = {
    1: "interfaceAlias",
    2: "portComponent",
    3: "macAddress",
    4: "networkAddress",
    5: "interfaceName",
    6: "agentCircuitId",
    7: "local",
  };
  return names[subtype] || `unknown (${subtype})`;
}

export const fetchAndProcessLldpData = (
  ipAddress: string,
  community: string,
) => {
  const oidRemTable = "1.0.8802.1.1.2.1.4.1";
  const session = snmp.createSession(ipAddress, community);

  return new Promise<any[]>((resolve, reject) => {
    session.table(oidRemTable, (error: any, tableData: any) => {
      if (error) {
        console.error(
          `[${new Date().toISOString()}] Terjadi kesalahan saat mengambil data lldp table untuk ${ipAddress}:`,
          error,
        );
        if (error instanceof snmp.RequestTimedOutError) {
          reject(
            new Error(`SNMP Request Timed Out saat mengambil LLDP neighbors.`),
          );
        } else if (error instanceof snmp.RequestFailedError) {
          reject(
            new Error(
              `SNMP Request Failed saat mengambil LLDP neighbors: ${
                error.message
              } (Status: ${error.status || "N/A"})`,
            ),
          );
        } else {
          reject(
            new Error(
              `SNMP Error lainnya saat mengambil LLDP neighbors: ${error.toString()}`,
            ),
          );
        }
        return;
      }
      if (!tableData || Object.keys(tableData).length === 0) {
        resolve([]);
        return;
      }
      const processedNeighbors = Object.entries(tableData).map(
        ([compositeIndex, columns]: [string, any]) => {
          const indexParts = compositeIndex.split(".");
          const localPortIfIndex =
            indexParts.length > 1 ? parseInt(indexParts[1], 10) : null;

          return {
            compositeIndex,
            localPortIfIndex,
            remoteChassisIdSubtypeCode: columns["4"]
              ? parseInt(safeToString(columns["4"]) || "0", 10)
              : null,
            remoteChassisIdSubtypeName: columns["4"]
              ? getChassisIdSubtypeName(
                  parseInt(safeToString(columns["4"]) || "0", 10),
                )
              : null,
            remoteChassisId:
              parseInt(safeToString(columns["4"]) || "0", 10) === 4
                ? safeToString(columns["5"], "hex")
                : safeToString(columns["5"]),
            remotePortIdSubtypeCode: columns["6"]
              ? parseInt(safeToString(columns["6"]) || "0", 10)
              : null,
            remotePortIdSubtypeName: columns["6"]
              ? getPortIdSubtypeName(
                  parseInt(safeToString(columns["6"]) || "0", 10),
                )
              : null,
            remotePortId:
              parseInt(safeToString(columns["6"]) || "0", 10) === 3
                ? safeToString(columns["7"], "hex")
                : safeToString(columns["7"]),
            remotePortDescription: safeToString(columns["8"]),
            remoteSystemName: safeToString(columns["9"]),
            remoteSystemDescription: safeToString(columns["10"]),
          };
        },
      );

      resolve(processedNeighbors);
    });
  });
};

// Function to discover available storage indices
const discoverStorageIndices = (
  ipAddress: string,
  community: string,
): Promise<number[]> => {
  return new Promise((resolve) => {
    // Skip discovery if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      resolve([1, 2, 3, 4, 5]);
      return;
    }

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
          // Mark as failed if timeout to prevent future attempts
          if (
            error.message &&
            error.message.toLowerCase().includes("timed out")
          ) {
            markDeviceAsFailed(ipAddress);
          }
          // Return common indices as fallback
          resolve([1, 2, 3, 4, 5]);
        } else {
          resolve(indices.length > 0 ? indices : [1, 2, 3, 4, 5]);
        }
      },
    );
  });
};

// Function to discover Huawei entity indices
const discoverHuaweiEntityIndices = (
  ipAddress: string,
  community: string,
): Promise<number[]> => {
  return new Promise((resolve) => {
    // Skip discovery if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      resolve([67108867, 67108868, 1, 2]);
      return;
    }

    const session = snmp.createSession(ipAddress, community, {
      timeout: 2000,
      retries: 0,
    });

    const entityClassOid = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.2"; // hwEntityBomEnDesc
    const indices: number[] = [];

    session.subtree(
      entityClassOid,
      (varbinds: any) => {
        varbinds.forEach((vb: any) => {
          // Look for main board entities
          const oidParts = vb.oid.split(".");
          const index = parseInt(oidParts[oidParts.length - 1]);
          if (!isNaN(index) && index > 1000000) {
            // Main board indices are typically large
            indices.push(index);
          }
        });
      },
      (error: any) => {
        session.close();
        if (error) {
          console.warn(
            `Huawei entity discovery failed for ${ipAddress}: ${error.message}`,
          );
          // Return common Huawei indices as fallback
          resolve([67108867, 67108868, 1, 2]);
        } else {
          resolve(indices.length > 0 ? indices : [67108867, 67108868, 1, 2]);
        }
      },
    );
  });
};

// SNMP OIDs for CPU and RAM monitoring by vendor with fallback options
const SNMP_OIDS = {
  mikrotik: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index (should return percentage)
      "1.3.6.1.2.1.25.3.3.1.2.2", // hrProcessorLoad with alt index
      "1.3.6.1.2.1.25.3.3.1.2.0", // hrProcessorLoad with .0
      "1.3.6.1.4.1.14988.1.1.3.14.0", // mtxrSystemCpuLoad (returns 0-255, needs conversion)
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize for Physical memory
        "1.3.6.1.2.1.25.2.3.1.5.2", // hrStorageSize alternative index
        "1.3.6.1.4.1.14988.1.1.1.2.0", // mtxrSystemMemoryTotal (in bytes)
        "1.3.6.1.2.1.25.2.3.1.5.65536", // hrStorageSize common RAM index
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed for Physical memory
        "1.3.6.1.2.1.25.2.3.1.6.2", // hrStorageUsed alternative index
        "1.3.6.1.4.1.14988.1.1.1.1.0", // mtxrSystemMemoryFree (free memory, needs calculation)
        "1.3.6.1.2.1.25.2.3.1.6.65536", // hrStorageUsed common RAM index
      ],
    },
  },
  juniper: {
    cpu: [
      "1.3.6.1.4.1.2636.3.1.13.1.8.1", // jnxOperatingCpu with index
      "1.3.6.1.4.1.2636.3.1.13.1.8.2", // jnxOperatingCpu alt index
      "1.3.6.1.4.1.2636.3.1.13.1.8", // jnxOperatingCpu without index
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad fallback
    ],
    ram: {
      total: [
        "1.3.6.1.4.1.2636.3.1.13.1.11.1", // jnxOperatingMemory with index
        "1.3.6.1.4.1.2636.3.1.13.1.11.2", // jnxOperatingMemory alt index
        "1.3.6.1.4.1.2636.3.1.13.1.11", // jnxOperatingMemory without index
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize fallback
      ],
      used: [
        "1.3.6.1.4.1.2636.3.1.13.1.15.1", // jnxOperatingBuffer with index
        "1.3.6.1.4.1.2636.3.1.13.1.15.2", // jnxOperatingBuffer alt index
        "1.3.6.1.4.1.2636.3.1.13.1.15", // jnxOperatingBuffer without index
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed fallback
      ],
    },
  },
  huawei: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad (more reliable for Huawei)
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108867", // hwEntityCpuUsage main board
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108868", // hwEntityCpuUsage alt board
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1", // hwEntityCpuUsage generic index
      "1.3.6.1.4.1.2011.6.139.2.6.1.1.1.1.6.1", // hwCpuDevTable (alternative)
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize (more reliable for Huawei)
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108867", // hwEntityMemSize main board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108868", // hwEntityMemSize alt board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.1", // hwEntityMemSize generic index
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed (more reliable for Huawei)
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.67108867", // hwEntityMemUsage main board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.67108868", // hwEntityMemUsage alt board
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.1", // hwEntityMemUsage generic index
      ],
    },
  },
  cisco: {
    cpu: [
      "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1", // cpmCPUTotal5minRev
      "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", // cpmCPUTotal1minRev
      "1.3.6.1.4.1.9.2.1.56.0", // avgBusy5 (older IOS)
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad fallback
    ],
    ram: {
      total: [
        "1.3.6.1.4.1.9.9.48.1.1.1.5.1", // ciscoMemoryPoolTotal
        "1.3.6.1.4.1.9.2.1.8.0", // freeMem (older)
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize fallback
      ],
      used: [
        "1.3.6.1.4.1.9.9.48.1.1.1.6.1", // ciscoMemoryPoolUsed
        "1.3.6.1.4.1.9.2.1.9.0", // bufferMem (older)
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed fallback
      ],
    },
  },
  hp: {
    cpu: [
      "1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0", // hpSwitchCpuStat
      "1.3.6.1.4.1.25506.2.6.1.1.1.1.6.1", // hpnicfEntityExtCpuUsage
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad fallback
    ],
    ram: {
      total: [
        "1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.5.1", // hpSwitchMemTotal
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize fallback
      ],
      used: [
        "1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.6.1", // hpSwitchMemUsed
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed fallback
      ],
    },
  },
  generic: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index
      "1.3.6.1.2.1.25.3.3.1.2.2", // hrProcessorLoad alt index
      "1.3.6.1.2.1.25.3.3.1.2.0", // hrProcessorLoad with .0
      "1.3.6.1.2.1.25.3.3.1.2", // hrProcessorLoad table
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize for RAM
        "1.3.6.1.2.1.25.2.3.1.5.2", // hrStorageSize alternative
        "1.3.6.1.2.1.25.2.3.1.5.3", // hrStorageSize alternative 2
        "1.3.6.1.2.1.25.2.3.1.5.4", // hrStorageSize alternative 3
        "1.3.6.1.2.1.25.2.3.1.5.5", // hrStorageSize alternative 4
        "1.3.6.1.2.1.25.2.2.0", // hrMemorySize
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed for RAM
        "1.3.6.1.2.1.25.2.3.1.6.2", // hrStorageUsed alternative
        "1.3.6.1.2.1.25.2.3.1.6.3", // hrStorageUsed alternative 2
        "1.3.6.1.2.1.25.2.3.1.6.4", // hrStorageUsed alternative 3
        "1.3.6.1.2.1.25.2.3.1.6.5", // hrStorageUsed alternative 4
        "1.3.6.1.2.1.25.5.1.1.2.1", // hrSWRunPerfMem
      ],
    },
  },
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

// Function to check if device recently failed
const isDeviceRecentlyFailed = (ipAddress: string): boolean => {
  const failedEntry = failedDeviceCache.get(ipAddress);
  if (!failedEntry) return false;

  const isStillFailed = Date.now() - failedEntry.timestamp < failedEntry.ttl;
  if (!isStillFailed) {
    failedDeviceCache.delete(ipAddress);
  }
  return isStillFailed;
};

// Function to mark device as failed
const markDeviceAsFailed = (ipAddress: string): void => {
  failedDeviceCache.set(ipAddress, {
    timestamp: Date.now(),
    ttl: FAILED_DEVICE_TTL,
  });
};

// Function to get CPU usage via SNMP with fallback mechanism and caching
export const fetchCpuUsage = (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise(async (resolve) => {
    // Skip if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      console.warn(
        `[${new Date().toISOString()}] Skipping ${ipAddress} - device recently failed`,
      );
      resolve(null);
      return;
    }

    // Check cache for working OID
    const cacheKey = getCacheKey(ipAddress, vendor);
    const cached = oidCache.get(cacheKey);

    if (cached && isCacheValid(cached) && cached.workingOids.cpu) {
      // Use cached working OID first
      try {
        const result = await trySpecificCpuOid(
          ipAddress,
          community,
          cached.workingOids.cpu,
          vendor,
        );
        if (result !== null) {
          resolve(result);
          return;
        }
      } catch (error) {
        // Cache might be stale, continue with discovery
      }
    }
    const session = snmp.createSession(ipAddress, community, {
      timeout: 5000,
      retries: 1,
    });

    const oids =
      SNMP_OIDS[vendor as keyof typeof SNMP_OIDS] || SNMP_OIDS.generic;
    const cpuOids = Array.isArray(oids.cpu) ? oids.cpu : [oids.cpu];

    // Get cached failed OIDs to skip
    let existingCache = oidCache.get(cacheKey) || {
      workingOids: {},
      failedOids: { cpu: [], ramTotal: [], ramUsed: [] },
      timestamp: Date.now(),
      ttl: CACHE_TTL,
    };

    // Filter out failed OIDs
    const filteredCpuOids = cpuOids.filter(
      (oid) => !existingCache.failedOids.cpu.includes(oid),
    );

    if (filteredCpuOids.length === 0) {
      console.warn(
        `[${new Date().toISOString()}] All CPU OIDs already failed for ${ipAddress}`,
      );
      resolve(null);
      return;
    }

    // Try each OID until one works or timeout occurs
    let hasTimeout = false;
    for (const oid of filteredCpuOids) {
      try {
        const result = await trySpecificCpuOid(
          ipAddress,
          community,
          oid,
          vendor,
        );

        if (result !== null) {
          // Cache the working OID and update cache
          existingCache.workingOids.cpu = oid;
          existingCache.timestamp = Date.now();
          oidCache.set(cacheKey, existingCache);

          console.log(
            `[${new Date().toISOString()}] CPU OID ${oid} successful for ${ipAddress}`,
          );
          resolve(result);
          return;
        } else {
          // Add failed OID to cache
          if (!existingCache.failedOids.cpu.includes(oid)) {
            existingCache.failedOids.cpu.push(oid);
          }
        }
      } catch (error: any) {
        // Add failed OID to cache
        if (!existingCache.failedOids.cpu.includes(oid)) {
          existingCache.failedOids.cpu.push(oid);
        }

        // If timeout occurs, mark device as failed and stop trying
        if (error.message && error.message.includes("timed out")) {
          hasTimeout = true;
          break;
        }
        // Continue to next OID for other errors
        continue;
      }
    }

    // Update cache with failed OIDs
    oidCache.set(cacheKey, existingCache);

    // If timeout occurred, mark device as failed
    if (hasTimeout) {
      markDeviceAsFailed(ipAddress);
      console.warn(
        `[${new Date().toISOString()}] Device ${ipAddress} marked as failed due to timeout`,
      );
    } else {
      console.error(
        `[${new Date().toISOString()}] All CPU OIDs failed for ${ipAddress}`,
      );
    }

    resolve(null);
  });
};

// Helper function to try a specific CPU OID
const trySpecificCpuOid = (
  ipAddress: string,
  community: string,
  oid: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ipAddress, community, {
      timeout: 3000,
      retries: 0,
    });

    session.get([oid], (error: any, varbinds: any) => {
      session.close();

      if (error) {
        console.warn(
          `[${new Date().toISOString()}] OID ${oid} failed for ${ipAddress}:`,
          error.message,
        );
        // Reject on timeout to stop further attempts
        if (
          error.message &&
          error.message.toLowerCase().includes("timed out")
        ) {
          reject(new Error("timed out"));
        } else {
          resolve(null);
        }
        return;
      }

      try {
        if (varbinds && varbinds.length > 0 && varbinds[0].value !== null) {
          let cpuUsage = parseInt(varbinds[0].value.toString());
          const rawValue = cpuUsage;

          // Debug log for MikroTik and Huawei
          if (vendor === "mikrotik" || vendor === "huawei") {
            console.log(
              `[DEBUG] ${vendor.toUpperCase()} ${ipAddress} - OID: ${oid}, Raw CPU value: ${rawValue}`,
            );
          }

          // Some devices return CPU as percentage directly, others need calculation
          if (vendor === "juniper") {
            // Juniper returns value that needs to be interpreted
            cpuUsage = Math.min(100, Math.max(0, cpuUsage));
          } else if (vendor === "mikrotik") {
            if (oid.includes("14988.1.1.3.14")) {
              // MikroTik specific OID returns value 0-255 (needs to be converted to percentage)
              cpuUsage = Math.min(
                100,
                Math.max(0, Math.round((cpuUsage * 100) / 255)),
              );
              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Converted CPU from 0-255 scale: ${rawValue} -> ${cpuUsage}%`,
              );
            } else if (oid.includes("1.3.6.1.2.1.25.3.3.1.2")) {
              // Standard hrProcessorLoad for MikroTik - but sometimes returns values > 100
              // MikroTik hrProcessorLoad can return values like 10000 for 100%
              if (cpuUsage > 100) {
                // Likely scaled by 100 (e.g., 10000 = 100%)
                cpuUsage = Math.min(100, Math.max(0, cpuUsage / 100));
                console.log(
                  `[DEBUG] MikroTik ${ipAddress} - Scaled CPU from centipercent: ${rawValue} -> ${cpuUsage}%`,
                );
              } else {
                // Direct percentage value
                cpuUsage = Math.min(100, Math.max(0, cpuUsage));
                console.log(
                  `[DEBUG] MikroTik ${ipAddress} - Direct CPU percentage: ${cpuUsage}%`,
                );
              }
            } else {
              // Generic MikroTik handling
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Generic CPU: ${cpuUsage}%`,
              );
            }
          } else if (vendor === "huawei") {
            if (oid.includes("2011.5.25.31.1.1.1.1.5")) {
              // Huawei hwEntityCpuUsage - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              console.log(
                `[DEBUG] Huawei ${ipAddress} - Entity CPU usage: ${cpuUsage}%`,
              );
            } else if (oid.includes("2011.6.139.2.6.1.1.1.1.6")) {
              // Huawei hwCpuDevTable - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              console.log(
                `[DEBUG] Huawei ${ipAddress} - CPU dev table: ${cpuUsage}%`,
              );
            } else {
              // Standard hrProcessorLoad for Huawei
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              console.log(
                `[DEBUG] Huawei ${ipAddress} - Standard CPU: ${cpuUsage}%`,
              );
            }
          } else if (vendor === "cisco") {
            // Cisco returns percentage directly
            cpuUsage = Math.min(100, Math.max(0, cpuUsage));
          } else if (vendor === "hp") {
            // HP returns percentage directly
            cpuUsage = Math.min(100, Math.max(0, cpuUsage));
          }

          resolve(cpuUsage);
        } else {
          resolve(null);
        }
      } catch (parseError) {
        console.warn(
          `[${new Date().toISOString()}] Error parsing CPU usage for ${ipAddress}:`,
          parseError,
        );
        resolve(null);
      }
    });
  });
};

// Function to get RAM usage via SNMP with fallback mechanism and caching
export const fetchRamUsage = (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise(async (resolve) => {
    // Skip if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      console.warn(
        `[${new Date().toISOString()}] Skipping ${ipAddress} - device recently failed`,
      );
      resolve(null);
      return;
    }

    // Check cache for working OIDs
    const cacheKey = getCacheKey(ipAddress, vendor);
    const cached = oidCache.get(cacheKey);

    if (
      cached &&
      isCacheValid(cached) &&
      cached.workingOids.ramTotal &&
      cached.workingOids.ramUsed
    ) {
      // Use cached working OIDs first
      try {
        const result = await trySpecificRamOids(
          ipAddress,
          community,
          cached.workingOids.ramTotal,
          cached.workingOids.ramUsed,
          vendor,
        );
        if (result !== null) {
          resolve(result);
          return;
        }
      } catch (error) {
        // Cache might be stale, continue with discovery
      }
    }
    const oids =
      SNMP_OIDS[vendor as keyof typeof SNMP_OIDS] || SNMP_OIDS.generic;
    const totalOids = Array.isArray(oids.ram.total)
      ? oids.ram.total
      : [oids.ram.total];
    const usedOids = Array.isArray(oids.ram.used)
      ? oids.ram.used
      : [oids.ram.used];

    // Try to discover indices for specific vendors
    let dynamicOids: string[] = [];
    if (vendor === "generic") {
      try {
        const indices = await discoverStorageIndices(ipAddress, community);
        dynamicOids = indices.flatMap((idx) => [
          `1.3.6.1.2.1.25.2.3.1.5.${idx}`,
          `1.3.6.1.2.1.25.2.3.1.6.${idx}`,
        ]);
      } catch (error) {
        // Continue with static OIDs
      }
    } else if (vendor === "huawei") {
      try {
        const indices = await discoverHuaweiEntityIndices(ipAddress, community);
        dynamicOids = indices.flatMap((idx) => [
          `1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.${idx}`,
          `1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.${idx}`,
        ]);
        console.log(
          `[DEBUG] Huawei ${ipAddress} - Discovered entity indices: ${indices.join(", ")}`,
        );
      } catch (error) {
        // Continue with static OIDs
      }
    }

    // Combine static and dynamic OIDs
    const allTotalOids = [
      ...totalOids,
      ...dynamicOids.filter((_, i) => i % 2 === 0),
    ];
    const allUsedOids = [
      ...usedOids,
      ...dynamicOids.filter((_, i) => i % 2 === 1),
    ];

    // Get cached failed OIDs to skip
    const ramCacheKey = getCacheKey(ipAddress, vendor);
    let existingRamCache = oidCache.get(ramCacheKey) || {
      workingOids: {},
      failedOids: { cpu: [], ramTotal: [], ramUsed: [] },
      timestamp: Date.now(),
      ttl: CACHE_TTL,
    };

    // Filter out failed OIDs
    const filteredTotalOids = allTotalOids.filter(
      (oid) => !existingRamCache.failedOids.ramTotal.includes(oid),
    );
    const filteredUsedOids = allUsedOids.filter(
      (oid) => !existingRamCache.failedOids.ramUsed.includes(oid),
    );

    if (filteredTotalOids.length === 0 || filteredUsedOids.length === 0) {
      console.warn(
        `[${new Date().toISOString()}] All RAM OIDs already failed for ${ipAddress}`,
      );
      resolve(null);
      return;
    }

    // Try different combinations of total and used OIDs
    let hasTimeout = false;
    for (const totalOid of filteredTotalOids) {
      if (hasTimeout) break;
      for (const usedOid of filteredUsedOids) {
        try {
          const result = await trySpecificRamOids(
            ipAddress,
            community,
            totalOid,
            usedOid,
            vendor,
          );

          if (result !== null) {
            // Cache the working OID combination
            existingRamCache.workingOids.ramTotal = totalOid;
            existingRamCache.workingOids.ramUsed = usedOid;
            existingRamCache.timestamp = Date.now();
            oidCache.set(ramCacheKey, existingRamCache);

            console.log(
              `[${new Date().toISOString()}] RAM OIDs ${totalOid}, ${usedOid} successful for ${ipAddress}`,
            );
            resolve(result);
            return;
          } else {
            // Add failed OIDs to cache
            if (!existingRamCache.failedOids.ramTotal.includes(totalOid)) {
              existingRamCache.failedOids.ramTotal.push(totalOid);
            }
            if (!existingRamCache.failedOids.ramUsed.includes(usedOid)) {
              existingRamCache.failedOids.ramUsed.push(usedOid);
            }
          }
        } catch (error: any) {
          // Add failed OIDs to cache
          if (!existingRamCache.failedOids.ramTotal.includes(totalOid)) {
            existingRamCache.failedOids.ramTotal.push(totalOid);
          }
          if (!existingRamCache.failedOids.ramUsed.includes(usedOid)) {
            existingRamCache.failedOids.ramUsed.push(usedOid);
          }

          // If timeout occurs, mark device as failed and stop trying
          if (error.message && error.message.includes("timed out")) {
            hasTimeout = true;
            break;
          }
          // Continue to next OID combination for other errors
          continue;
        }
      }
    }

    // Update cache with failed OIDs
    oidCache.set(ramCacheKey, existingRamCache);

    // If timeout occurred, mark device as failed
    if (hasTimeout) {
      markDeviceAsFailed(ipAddress);
      console.warn(
        `[${new Date().toISOString()}] Device ${ipAddress} marked as failed due to timeout`,
      );
    } else {
      console.error(
        `[${new Date().toISOString()}] All RAM OIDs failed for ${ipAddress}`,
      );
    }

    resolve(null);
  });
};

// Helper function to try specific RAM OIDs
const trySpecificRamOids = (
  ipAddress: string,
  community: string,
  totalOid: string,
  usedOid: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ipAddress, community, {
      timeout: 3000,
      retries: 0,
    });

    session.get([totalOid, usedOid], (error: any, varbinds: any) => {
      session.close();

      if (error) {
        console.warn(
          `[${new Date().toISOString()}] OIDs ${totalOid}, ${usedOid} failed for ${ipAddress}:`,
          error.message,
        );
        // Reject on timeout to stop further attempts
        if (
          error.message &&
          error.message.toLowerCase().includes("timed out")
        ) {
          reject(new Error("timed out"));
        } else {
          resolve(null);
        }
        return;
      }

      try {
        if (
          varbinds &&
          varbinds.length >= 2 &&
          varbinds[0].value !== null &&
          varbinds[1].value !== null
        ) {
          let totalRam = parseInt(varbinds[0].value.toString());
          let usedRam = parseInt(varbinds[1].value.toString());

          // Debug log for MikroTik and Huawei
          if (vendor === "mikrotik" || vendor === "huawei") {
            console.log(
              `[DEBUG] ${vendor.toUpperCase()} ${ipAddress} - Total OID: ${totalOid}, Used OID: ${usedOid}`,
            );
            console.log(
              `[DEBUG] ${vendor.toUpperCase()} ${ipAddress} - Raw RAM values - Total: ${totalRam}, Used/Free: ${usedRam}`,
            );
          }

          // Handle different MikroTik memory OIDs
          if (vendor === "mikrotik") {
            if (usedOid.includes("14988.1.1.1.1")) {
              // This is free memory, convert to used
              const originalFree = usedRam;
              usedRam = totalRam - usedRam; // Convert free to used
              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Converted RAM: Free ${originalFree} -> Used ${usedRam}`,
              );
            } else if (
              totalOid.includes("14988.1.1.1.2") ||
              usedOid.includes("14988.1.1.1")
            ) {
              // MikroTik specific OIDs return values in bytes, might need conversion
              // Usually these are already in correct format, but let's log for debugging
              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Native MikroTik OIDs - Total: ${totalRam}, Used: ${usedRam}`,
              );
            }

            // Check for unrealistic values that might indicate wrong scale
            if (totalRam < 1024) {
              // Values too small, might be in MB instead of bytes
              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Values seem to be in MB, converting to bytes`,
              );
              totalRam = totalRam * 1024 * 1024; // Convert MB to bytes
              usedRam = usedRam * 1024 * 1024;
            }
          }

          if (totalRam > 0) {
            let ramUsagePercent;

            if (vendor === "huawei") {
              // Handle different Huawei memory reporting formats
              if (
                totalOid.includes("2011.5.25.31.1.1.1.1.7") &&
                usedOid.includes("2011.5.25.31.1.1.1.1.8")
              ) {
                // Huawei Entity MIB - hwEntityMemSize and hwEntityMemUsage
                // These might return values in KB or percentage
                if (usedRam <= 100 && totalRam > 100) {
                  // Used is percentage, total is actual size
                  ramUsagePercent = usedRam;
                  console.log(
                    `[DEBUG] Huawei ${ipAddress} - Memory usage as percentage: ${ramUsagePercent}%`,
                  );
                } else if (totalRam > 0) {
                  // Both are actual values, calculate percentage
                  ramUsagePercent = (usedRam / totalRam) * 100;
                  console.log(
                    `[DEBUG] Huawei ${ipAddress} - Memory calculated: ${usedRam}/${totalRam} = ${ramUsagePercent.toFixed(2)}%`,
                  );
                }
              } else {
                // Standard hrStorage OIDs - calculate normally
                ramUsagePercent = (usedRam / totalRam) * 100;
                console.log(
                  `[DEBUG] Huawei ${ipAddress} - Standard memory calculation: ${usedRam}/${totalRam} = ${ramUsagePercent.toFixed(2)}%`,
                );
              }
            } else if (vendor === "juniper") {
              // Juniper calculation
              ramUsagePercent = totalRam > 0 ? (usedRam / totalRam) * 100 : 0;
            } else if (vendor === "mikrotik") {
              // MikroTik calculation - handle different scales
              ramUsagePercent = (usedRam / totalRam) * 100;

              // Sanity check for MikroTik - sometimes values are in wrong units
              if (ramUsagePercent > 100) {
                console.log(
                  `[DEBUG] MikroTik ${ipAddress} - RAM percentage > 100%, checking for unit mismatch`,
                );
                // Try different conversions
                if ((usedRam / 1024 / totalRam) * 100 <= 100) {
                  ramUsagePercent = (usedRam / 1024 / totalRam) * 100;
                  console.log(
                    `[DEBUG] MikroTik ${ipAddress} - Applied /1024 correction: ${ramUsagePercent.toFixed(2)}%`,
                  );
                }
              }

              console.log(
                `[DEBUG] MikroTik ${ipAddress} - Final RAM calculation: ${usedRam}/${totalRam} = ${ramUsagePercent.toFixed(2)}%`,
              );
            } else if (vendor === "cisco") {
              // Cisco calculation - handle different memory pool types
              ramUsagePercent = (usedRam / totalRam) * 100;
            } else if (vendor === "hp") {
              // HP calculation - usually in KB
              ramUsagePercent = (usedRam / totalRam) * 100;
            } else {
              // Generic calculation
              ramUsagePercent = (usedRam / totalRam) * 100;
            }

            resolve(
              Math.min(
                100,
                Math.max(0, Math.round(ramUsagePercent * 100) / 100),
              ),
            );
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      } catch (parseError) {
        console.warn(
          `[${new Date().toISOString()}] Error parsing RAM usage for ${ipAddress}:`,
          parseError,
        );
        resolve(null);
      }
    });
  });
};

// Function to fetch both CPU and RAM usage
export const fetchSystemUsage = async (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<{ cpuUsage: number | null; ramUsage: number | null }> => {
  try {
    // Skip if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      console.warn(
        `[${new Date().toISOString()}] Skipping system usage for ${ipAddress} - device recently failed`,
      );
      return { cpuUsage: null, ramUsage: null };
    }

    // Set timeout for the entire operation
    const timeout = 10000; // 10 seconds max total time
    const timeoutPromise = new Promise<{ cpuUsage: null; ramUsage: null }>(
      (resolve) => {
        setTimeout(() => {
          console.warn(
            `[${new Date().toISOString()}] System usage fetch timeout for ${ipAddress}`,
          );
          markDeviceAsFailed(ipAddress);
          resolve({ cpuUsage: null, ramUsage: null });
        }, timeout);
      },
    );

    // Race between actual fetching and timeout
    const fetchPromise = (async () => {
      const [cpuUsage, ramUsage] = await Promise.all([
        fetchCpuUsage(ipAddress, community, vendor),
        fetchRamUsage(ipAddress, community, vendor),
      ]);
      return { cpuUsage, ramUsage };
    })();

    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error fetching system usage for ${ipAddress}:`,
      error,
    );
    markDeviceAsFailed(ipAddress);
    return { cpuUsage: null, ramUsage: null };
  }
};

// Function to clear expired cache entries
export const clearExpiredCache = (): void => {
  const now = Date.now();
  for (const [key, entry] of oidCache.entries()) {
    if (now - entry.timestamp >= entry.ttl) {
      oidCache.delete(key);
    }
  }

  // Also clear expired failed device entries
  for (const [key, entry] of failedDeviceCache.entries()) {
    if (now - entry.timestamp >= entry.ttl) {
      failedDeviceCache.delete(key);
    }
  }
};

// Function to get cache statistics
export const getCacheStats = () => {
  const totalEntries = oidCache.size;
  let validEntries = 0;
  let totalFailedOids = 0;

  for (const entry of oidCache.values()) {
    if (isCacheValid(entry)) {
      validEntries++;
    }
    totalFailedOids +=
      entry.failedOids.cpu.length +
      entry.failedOids.ramTotal.length +
      entry.failedOids.ramUsed.length;
  }

  const failedDevices = failedDeviceCache.size;
  let validFailedEntries = 0;

  for (const entry of failedDeviceCache.values()) {
    if (Date.now() - entry.timestamp < entry.ttl) {
      validFailedEntries++;
    }
  }

  return {
    totalEntries,
    validEntries,
    expiredEntries: totalEntries - validEntries,
    totalFailedOids,
    failedDevices,
    validFailedEntries,
    expiredFailedEntries: failedDevices - validFailedEntries,
  };
};
