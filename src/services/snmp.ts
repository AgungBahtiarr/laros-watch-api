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

// Function to discover Huawei storage indices
const discoverHuaweiStorageIndices = (
  ipAddress: string,
  community: string,
): Promise<{ storageIndices: number[]; entityIndices: number[] }> => {
  return new Promise((resolve) => {
    // Skip discovery if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      resolve({
        storageIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        entityIndices: [67108867, 67108868, 67108864, 1, 2, 3, 4, 5],
      });
      return;
    }

    const session = snmp.createSession(ipAddress, community);
    const results = {
      storageIndices: new Set<number>(),
      entityIndices: new Set<number>(),
    };

    // Discover hrStorage indices first
    session.walk(
      "1.3.6.1.2.1.25.2.3.1.2",
      (varbinds: any[]) => {
        varbinds.forEach((varbind) => {
          if (varbind.type === snmp.ObjectType.OctetString) {
            const storageType = varbind.value.toString().toLowerCase();
            // Look for RAM/memory storage types
            if (
              storageType.includes("memory") ||
              storageType.includes("ram") ||
              storageType.includes("physical") ||
              storageType.includes("dram")
            ) {
              const oid = varbind.oid;
              const index = parseInt(oid.split(".").pop() || "0");
              if (index > 0) {
                results.storageIndices.add(index);
                console.log(
                  `[DEBUG] Found storage index ${index}: ${storageType}`,
                );
              }
            }
          }
        });
      },
      (error) => {
        if (!error) {
          // Now discover entity indices
          session.walk(
            "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.1",
            (varbinds: any[]) => {
              varbinds.forEach((varbind) => {
                const oid = varbind.oid;
                const index = parseInt(oid.split(".").pop() || "0");
                if (index > 0) {
                  results.entityIndices.add(index);
                  console.log(`[DEBUG] Found entity index ${index}`);
                }
              });
            },
            (error) => {
              session.close();
              const storageIndices = Array.from(results.storageIndices);
              const entityIndices = Array.from(results.entityIndices);

              // Add fallback indices if nothing found
              if (storageIndices.length === 0) {
                storageIndices.push(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
              }
              if (entityIndices.length === 0) {
                entityIndices.push(67108867, 67108868, 67108864, 1, 2, 3, 4, 5);
              }

              resolve({ storageIndices, entityIndices });
            },
          );
        } else {
          session.close();
          resolve({
            storageIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            entityIndices: [67108867, 67108868, 67108864, 1, 2, 3, 4, 5],
          });
        }
      },
    );
  });
};

// Function to discover available OIDs on Huawei devices
const discoverHuaweiAvailableOids = (
  ipAddress: string,
  community: string,
): Promise<string[]> => {
  return new Promise((resolve) => {
    const session = snmp.createSession(ipAddress, community);
    const discoveredOids: string[] = [];

    // Test common Huawei OID prefixes
    const testPrefixes = [
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1", // hwEntity MIB
      "1.3.6.1.4.1.2011.6.139.2.6.1.1.1.1", // hwCpu MIB
      "1.3.6.1.4.1.2011.6.1.3", // CE series
      "1.3.6.1.4.1.2011.10.2.6.1.1.1.1", // System MIB
    ];

    let completed = 0;
    const total = testPrefixes.length;

    testPrefixes.forEach((prefix) => {
      session.walk(
        prefix,
        (varbinds: any[]) => {
          varbinds.forEach((varbind) => {
            const oid = varbind.oid;
            // Check if this looks like a CPU or memory OID
            if (
              oid.includes(".5.") || // CPU usage
              oid.includes(".6.") || // CPU usage alt
              oid.includes(".7.") || // Memory size
              oid.includes(".8.") || // Memory usage
              oid.includes(".2.") || // Memory total
              oid.includes(".3.") // Memory used
            ) {
              discoveredOids.push(oid);
              console.log(`[DEBUG] Discovered potential OID: ${oid}`);
            }
          });
        },
        (error) => {
          completed++;
          if (completed === total) {
            session.close();
            resolve(Array.from(new Set(discoveredOids))); // Remove duplicates
          }
        },
      );
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (completed < total) {
        session.close();
        resolve(Array.from(new Set(discoveredOids)));
      }
    }, 5000);
  });
};

// Function to discover Huawei entity indices (legacy function for backward compatibility)
const discoverHuaweiEntityIndices = (
  ipAddress: string,
  community: string,
): Promise<number[]> => {
  return new Promise((resolve) => {
    // Skip discovery if device recently failed
    if (isDeviceRecentlyFailed(ipAddress)) {
      resolve([67108867, 67108868, 67108864, 1, 2, 3, 4, 5]);
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
          // Return extended Huawei indices as fallback
          resolve([67108867, 67108868, 67108864, 1, 2, 3, 4, 5, 6, 7, 8]);
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
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index (should return percentage) - PRIORITY OID
      "1.3.6.1.2.1.25.3.3.1.2.2", // hrProcessorLoad with alt index
      "1.3.6.1.2.1.25.3.3.1.2.0", // hrProcessorLoad with .0
      "1.3.6.1.4.1.14988.1.1.3.14.0", // mtxrSystemCpuLoad (returns 0-255, needs conversion)
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.65536", // hrStorageSize common RAM index - PRIORITY OID
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize for Physical memory
        "1.3.6.1.2.1.25.2.3.1.5.2", // hrStorageSize alternative index
        "1.3.6.1.4.1.14988.1.1.1.2.0", // mtxrSystemMemoryTotal (in bytes)
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.65536", // hrStorageUsed common RAM index - PRIORITY OID
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed for Physical memory
        "1.3.6.1.2.1.25.2.3.1.6.2", // hrStorageUsed alternative index
        "1.3.6.1.4.1.14988.1.1.1.1.0", // mtxrSystemMemoryFree (free memory, needs calculation)
      ],
    },
  },
  juniper: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index - PRIORITY OID
      "1.3.6.1.4.1.2636.3.1.13.1.8.1", // jnxOperatingCpu with index
      "1.3.6.1.4.1.2636.3.1.13.1.8.2", // jnxOperatingCpu alt index
      "1.3.6.1.4.1.2636.3.1.13.1.8", // jnxOperatingCpu without index
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize - PRIORITY OID
        "1.3.6.1.4.1.2636.3.1.13.1.11.1", // jnxOperatingMemory with index
        "1.3.6.1.4.1.2636.3.1.13.1.11.2", // jnxOperatingMemory alt index
        "1.3.6.1.4.1.2636.3.1.13.1.11", // jnxOperatingMemory without index
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed - PRIORITY OID
        "1.3.6.1.4.1.2636.3.1.13.1.15.1", // jnxOperatingBuffer with index
        "1.3.6.1.4.1.2636.3.1.13.1.15.2", // jnxOperatingBuffer alt index
        "1.3.6.1.4.1.2636.3.1.13.1.15", // jnxOperatingBuffer without index
      ],
    },
  },
  huawei: {
    cpu: [
      // CE6860 WORKING OIDs - ABSOLUTE PRIORITY - CONFIRMED WORKING
      "1.3.6.1.4.1.2011.6.3.4.1.2.1.1.0", // hwCpuCurrentUsage - CONFIRMED WORKING (11%) - FIRST PRIORITY
      "1.3.6.1.4.1.2011.6.3.4.1.3.1.1.0", // hwCpuCurrentUsage alt - CONFIRMED WORKING (10%) - SECOND PRIORITY
      "1.3.6.1.4.1.2011.6.3.4.1.4.1.1.0", // hwCpuCurrentUsage alt2 - CONFIRMED WORKING (10%) - THIRD PRIORITY
      // Alternative working patterns (lower priority)
      "1.3.6.1.4.1.2011.6.3.4.1.2.1", // hwCpuCurrentUsage without .1.0
      "1.3.6.1.4.1.2011.6.3.4.1.3.1", // hwCpuCurrentUsage alt without .1.0
      // Other Huawei branches (much lower priority)
      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1", // hwEntityCpuUsage
      "1.3.6.1.4.1.2011.6.139.2.6.1.1.1.1.6.1", // hwCpuDevTable
      "1.3.6.1.4.1.2011.6.1.3.2.1.5.1", // hwCpuUsage (CE series)
      "1.3.6.1.4.1.2011.10.2.6.1.1.1.1.6.1", // hwSystemCpuUsage
      "1.3.6.1.4.1.2011.2.23.1.2.1.1.2.1", // hwCpuUsage S-series
      // Standard OIDs (fallback)
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad
      "1.3.6.1.2.1.25.3.3.1.2.2", // hrProcessorLoad index 2
    ],
    ram: {
      total: [
        // CE6860 WORKING OIDs - ABSOLUTE PRIORITY - CONFIRMED WORKING
        "1.3.6.1.4.1.2011.6.3.5.1.1.2.1.1.0", // hwMemorySize - CONFIRMED WORKING (2033782784 bytes) - FIRST PRIORITY
        "1.3.6.1.4.1.2011.6.3.5.1.1.8.1.1.0", // hwMemoryTotal alt - CONFIRMED WORKING (2033782784 bytes)
        // Alternative working patterns (lower priority)
        "1.3.6.1.4.1.2011.6.3.5.1.1.2.1", // hwMemorySize without .1.0
        // Other Huawei branches (much lower priority)
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.1", // hwEntityMemSize
        "1.3.6.1.4.1.2011.6.1.3.3.1.3.1", // hwMemorySize (CE series)
        "1.3.6.1.4.1.2011.10.2.6.1.1.1.1.2.1", // hwSystemMemoryTotal
        "1.3.6.1.4.1.2011.2.23.1.2.1.1.3.1", // hwMemoryTotal S-series
        // Standard OIDs (fallback)
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize
        "1.3.6.1.2.1.25.2.3.1.5.2",
        "1.3.6.1.2.1.25.2.3.1.5.3",
      ],
      used: [
        // CE6860 WORKING OIDs - ABSOLUTE PRIORITY - CONFIRMED WORKING
        "1.3.6.1.4.1.2011.6.3.5.1.1.3.1.1.0", // hwMemoryUsed - CONFIRMED WORKING (973664256 bytes) - FIRST PRIORITY
        // Alternative working patterns (lower priority)
        "1.3.6.1.4.1.2011.6.3.5.1.1.3.1", // hwMemoryUsed without .1.0
        // Other Huawei branches (much lower priority)
        "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.1", // hwEntityMemUsage
        "1.3.6.1.4.1.2011.6.1.3.3.1.4.1", // hwMemoryUsed (CE series)
        "1.3.6.1.4.1.2011.10.2.6.1.1.1.1.3.1", // hwSystemMemoryUsed
        "1.3.6.1.4.1.2011.2.23.1.2.1.1.4.1", // hwMemoryUsed S-series
        // Standard OIDs (fallback)
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed
        "1.3.6.1.2.1.25.2.3.1.6.2",
        "1.3.6.1.2.1.25.2.3.1.6.3",
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

// Function to detect specific Huawei model/series
const getHuaweiModel = (os: string | null): string => {
  if (!os) return "generic";

  const osLower = os.toLowerCase();

  // CloudEngine series
  if (osLower.includes("cloudengine") || osLower.includes("ce")) {
    return "cloudengine";
  }

  // S series switches
  if (
    osLower.includes("s5700") ||
    osLower.includes("s6700") ||
    osLower.includes("s7700") ||
    osLower.includes("s9700")
  ) {
    return "s-series";
  }

  // AR series routers
  if (
    osLower.includes("ar1") ||
    osLower.includes("ar2") ||
    osLower.includes("ar3")
  ) {
    return "ar-series";
  }

  // NE series
  if (
    osLower.includes("ne40") ||
    osLower.includes("ne80") ||
    osLower.includes("ne")
  ) {
    return "ne-series";
  }

  // Default for other Huawei devices
  return "vrp-generic";
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
  // Don't mark CE6860 as failed - it needs special handling
  if (ipAddress === "172.16.100.4") {
    return;
  }

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
    // Skip if device recently failed, but allow CE6860 to retry with longer timeout
    if (isDeviceRecentlyFailed(ipAddress) && ipAddress !== "172.16.100.4") {
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

    // For Huawei devices, try static OIDs first (faster and more reliable)
    if (vendor === "huawei") {
    }
    const session = snmp.createSession(ipAddress, community, {
      timeout: 8000,
      retries: 0,
      version: snmp.Version2c,
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
        console.log(
          `[OID-TEST] 🔍 Testing CPU OID: ${oid} for ${ipAddress} (vendor: ${vendor})`,
        );

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
            `[OID-SUCCESS] ✅ CPU OID SUCCESSFUL: ${oid} for ${ipAddress} (vendor: ${vendor}) - Result: ${result}%`,
          );
          resolve(result);
          return;
        } else {
          console.log(
            `[OID-FAIL] ❌ CPU OID FAILED: ${oid} for ${ipAddress} (vendor: ${vendor}) - No data returned`,
          );
          // Add failed OID to cache
          if (!existingCache.failedOids.cpu.includes(oid)) {
            existingCache.failedOids.cpu.push(oid);
          }
        }
      } catch (error: any) {
        console.log(
          `[OID-ERROR] 💥 CPU OID ERROR: ${oid} for ${ipAddress} (vendor: ${vendor}) - ${error.message}`,
        );

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
        `[OID-SUMMARY] 🚫 ALL CPU OIDs FAILED for ${ipAddress} (vendor: ${vendor}) - Tested: ${filteredCpuOids.join(", ")}`,
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
      timeout: 8000, // Increased timeout for CE6860 compatibility
      retries: 0,
      version: snmp.Version2c,
    });

    session.get([oid], (error: any, varbinds: any) => {
      session.close();

      if (error) {
        // OID failed, try next one
        // Reject on timeout to stop further attempts, but be more lenient with CE6860
        if (
          error.message &&
          error.message.toLowerCase().includes("timed out")
        ) {
          if (ipAddress === "172.16.100.4") {
            resolve(null); // Don't reject for CE6860, just return null and try next OID
          } else {
            reject(new Error("timed out"));
          }
        } else {
          resolve(null);
        }
        return;
      }

      try {
        if (varbinds && varbinds.length > 0 && varbinds[0].value !== null) {
          let cpuUsage = parseInt(varbinds[0].value.toString());
          const rawValue = cpuUsage;

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
            if (oid.includes("2011.6.3.4.1")) {
              // CE6860 AR-series CPU OIDs - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (oid.includes("2011.5.25.31.1.1.1.1.5")) {
              // Huawei hwEntityCpuUsage - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (oid.includes("2011.6.139.2.6.1.1.1.1.6")) {
              // Huawei hwCpuDevTable - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (oid.includes("2011.6.1.3.2.1.5")) {
              // CE series CPU usage - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (oid.includes("2011.10.2.6.1.1.1.1.6")) {
              // System CPU usage - returns percentage directly
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (oid.includes("1.3.6.1.2.1.25.3.3.1.2")) {
              // Standard hrProcessorLoad for Huawei
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else {
              // Other Huawei OIDs
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
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
        // Parsing error, skip this OID
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
    // Skip if device recently failed, but allow CE6860 to retry with longer timeout
    if (isDeviceRecentlyFailed(ipAddress) && ipAddress !== "172.16.100.4") {
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

    // For Huawei devices, use static OIDs directly
    if (vendor === "huawei") {
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
        const discoveryResult = await discoverHuaweiStorageIndices(
          ipAddress,
          community,
        );
        const { storageIndices, entityIndices } = discoveryResult;

        // Build dynamic OIDs from discovered indices
        dynamicOids = [];

        // Add entity-based OIDs
        for (const idx of entityIndices) {
          dynamicOids.push(`1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.${idx}`);
          dynamicOids.push(`1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.${idx}`);
        }

        // Add storage-based OIDs
        for (const idx of storageIndices) {
          dynamicOids.push(`1.3.6.1.2.1.25.2.3.1.5.${idx}`);
          dynamicOids.push(`1.3.6.1.2.1.25.2.3.1.6.${idx}`);
        }
      } catch (error) {
        // Add comprehensive fallback OIDs
        const fallbackStorageIndices = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        ];
        const fallbackEntityIndices = [
          67108864, 67108867, 67108868, 1, 2, 3, 4, 5, 6, 7, 8,
        ];

        dynamicOids = [
          ...fallbackStorageIndices.flatMap((idx) => [
            `1.3.6.1.2.1.25.2.3.1.5.${idx}`,
            `1.3.6.1.2.1.25.2.3.1.6.${idx}`,
          ]),
          ...fallbackEntityIndices.flatMap((idx) => [
            `1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.${idx}`,
            `1.3.6.1.4.1.2011.5.25.31.1.1.1.1.8.${idx}`,
          ]),
        ];
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
          console.log(
            `[OID-TEST] 🔍 Testing RAM OIDs: Total=${totalOid}, Used=${usedOid} for ${ipAddress} (vendor: ${vendor})`,
          );

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
              `[OID-SUCCESS] ✅ RAM OIDs SUCCESSFUL: Total=${totalOid}, Used=${usedOid} for ${ipAddress} (vendor: ${vendor}) - Result: ${result}%`,
            );
            resolve(result);
            return;
          } else {
            console.log(
              `[OID-FAIL] ❌ RAM OIDs FAILED: Total=${totalOid}, Used=${usedOid} for ${ipAddress} (vendor: ${vendor}) - No data returned`,
            );
            // Add failed OIDs to cache
            if (!existingRamCache.failedOids.ramTotal.includes(totalOid)) {
              existingRamCache.failedOids.ramTotal.push(totalOid);
            }
            if (!existingRamCache.failedOids.ramUsed.includes(usedOid)) {
              existingRamCache.failedOids.ramUsed.push(usedOid);
            }
          }
        } catch (error: any) {
          console.log(
            `[OID-ERROR] 💥 RAM OIDs ERROR: Total=${totalOid}, Used=${usedOid} for ${ipAddress} (vendor: ${vendor}) - ${error.message}`,
          );

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
        `[OID-SUMMARY] 🚫 ALL RAM OIDs FAILED for ${ipAddress} (vendor: ${vendor}) - Tested Total: ${filteredTotalOids.join(", ")}, Tested Used: ${filteredUsedOids.join(", ")}`,
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
      timeout: 8000, // Increased timeout for CE6860 compatibility
      retries: 0,
      version: snmp.Version2c,
    });

    session.get([totalOid, usedOid], (error: any, varbinds: any) => {
      session.close();

      if (error) {
        // OID pair failed, try next one
        // Reject on timeout to stop further attempts, but be more lenient with CE6860
        if (
          error.message &&
          error.message.toLowerCase().includes("timed out")
        ) {
          if (ipAddress === "172.16.100.4") {
            resolve(null); // Don't reject for CE6860, just return null and try next OID pair
          } else {
            reject(new Error("timed out"));
          }
        } else {
          resolve(null);
        }
        return;
      }

      try {
        if (
          varbinds &&
          varbinds.length === 2 &&
          varbinds[0].value !== null &&
          varbinds[1].value !== null
        ) {
          let totalRam = parseInt(varbinds[0].value.toString());
          let usedRam = parseInt(varbinds[1].value.toString());

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
                totalOid.includes("2011.6.3.5.1.1") &&
                usedOid.includes("2011.6.3.5.1.1")
              ) {
                // CE6860 AR-series Memory OIDs - returns bytes
                ramUsagePercent = (usedRam / totalRam) * 100;
              } else if (
                totalOid.includes("2011.5.25.31.1.1.1.1.7") &&
                usedOid.includes("2011.5.25.31.1.1.1.1.8")
              ) {
                // Huawei Entity MIB - hwEntityMemSize and hwEntityMemUsage
                if (usedRam <= 100 && totalRam > 100) {
                  // Used is percentage, total is actual size
                  ramUsagePercent = usedRam;
                } else if (totalRam > 1000000000) {
                  // Values are in bytes
                  ramUsagePercent = (usedRam / totalRam) * 100;
                  const totalGB = (totalRam / 1024 / 1024 / 1024).toFixed(2);
                  const usedGB = (usedRam / 1024 / 1024 / 1024).toFixed(2);
                } else {
                  // Both are actual values, calculate percentage
                  ramUsagePercent = (usedRam / totalRam) * 100;
                }
              } else if (
                totalOid.includes("2011.6.1.3.3.1.3") &&
                usedOid.includes("2011.6.1.3.3.1.4")
              ) {
                // CE series memory - direct values in bytes
                ramUsagePercent = (usedRam / totalRam) * 100;
              } else if (
                totalOid.includes("2011.10.2.6.1.1.1.1.2") &&
                usedOid.includes("2011.10.2.6.1.1.1.1.3")
              ) {
                // System memory - direct values
                ramUsagePercent = (usedRam / totalRam) * 100;
              } else if (
                totalOid.includes("1.3.6.1.2.1.25.2.3.1.5") &&
                usedOid.includes("1.3.6.1.2.1.25.2.3.1.6")
              ) {
                // hrStorage - handle different unit interpretations for Huawei
                if (totalRam > 0) {
                  // Check if we need unit conversion
                  ramUsagePercent = (usedRam / totalRam) * 100;

                  // Some Huawei devices report hrStorage in unusual units
                  // If percentage seems too low, might need adjustment
                  if (ramUsagePercent < 1 && totalRam > 1000000) {
                    // Values might be in different units, try alternative calculation
                    console.log(
                      `[DEBUG] Huawei ${ipAddress} - hrStorage low percentage detected, checking for unit mismatch`,
                    );
                  }

                  ramUsagePercent = Math.min(100, Math.max(0, ramUsagePercent));
                } else {
                  ramUsagePercent = 0;
                }
              } else {
                // Standard memory calculation
                ramUsagePercent = (usedRam / totalRam) * 100;
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
        // Parsing error, skip this OID pair
        resolve(null);
      }
    });
  });
};

// Function to fetch both CPU and RAM usage
// Function to clear expired cache entries
// Function to test basic SNMP connectivity
export const testSNMPConnectivity = async (
  ipAddress: string,
  community: string,
): Promise<{
  connectivity: boolean;
  systemInfo?: any;
  supportedVersions: string[];
  error?: string;
}> => {
  console.log(`[SNMP-TEST] Testing basic SNMP connectivity for ${ipAddress}`);

  const results = {
    connectivity: false,
    supportedVersions: [] as string[],
    systemInfo: undefined as any,
    error: undefined as string | undefined,
  };

  // Test SNMPv1
  try {
    const sessionV1 = snmp.createSession(ipAddress, community, {
      version: snmp.Version1,
      timeout: 3000,
      retries: 0,
    });

    const sysDescrOid = "1.3.6.1.2.1.1.1.0"; // sysDescr
    const testResult = await new Promise((resolve, reject) => {
      sessionV1.get([sysDescrOid], (error: any, varbinds: any[]) => {
        sessionV1.close();
        if (error) {
          reject(error);
        } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
          resolve(varbinds[0].value.toString());
        } else {
          reject(new Error("No response"));
        }
      });
    });

    results.supportedVersions.push("SNMPv1");
    results.connectivity = true;
    results.systemInfo = { sysDescr: testResult };
    console.log(`[SNMP-TEST] ✅ SNMPv1 works: ${testResult}`);
  } catch (error) {
    console.log(`[SNMP-TEST] ❌ SNMPv1 failed: ${(error as Error).message}`);
  }

  // Test SNMPv2c
  try {
    const sessionV2c = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 3000,
      retries: 0,
    });

    const sysDescrOid = "1.3.6.1.2.1.1.1.0"; // sysDescr
    const testResult = await new Promise((resolve, reject) => {
      sessionV2c.get([sysDescrOid], (error: any, varbinds: any[]) => {
        sessionV2c.close();
        if (error) {
          reject(error);
        } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
          resolve(varbinds[0].value.toString());
        } else {
          reject(new Error("No response"));
        }
      });
    });

    results.supportedVersions.push("SNMPv2c");
    results.connectivity = true;
    if (!results.systemInfo) {
      results.systemInfo = { sysDescr: testResult };
    }
    console.log(`[SNMP-TEST] ✅ SNMPv2c works: ${testResult}`);
  } catch (error) {
    console.log(`[SNMP-TEST] ❌ SNMPv2c failed: ${(error as Error).message}`);
  }

  if (!results.connectivity) {
    results.error = "No SNMP connectivity detected with either v1 or v2c";
  }

  return results;
};

// Function to discover what OIDs are actually available on the device
export const discoverAvailableOids = async (
  ipAddress: string,
  community: string,
): Promise<string[]> => {
  console.log(`[OID-DISCOVERY] Discovering available OIDs for ${ipAddress}`);

  const session = snmp.createSession(ipAddress, community, {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 0,
  });

  const availableOids: string[] = [];

  // Walk the entire 1.3.6.1.4.1.2011 (Huawei enterprise) tree
  return new Promise((resolve) => {
    session.walk(
      "1.3.6.1.4.1.2011",
      (varbinds: any[]) => {
        varbinds.forEach((varbind) => {
          availableOids.push(varbind.oid);
          if (availableOids.length % 100 === 0) {
            console.log(
              `[OID-DISCOVERY] Found ${availableOids.length} OIDs so far...`,
            );
          }
        });
      },
      (error) => {
        session.close();
        if (error) {
          console.log(
            `[OID-DISCOVERY] Walk completed with error: ${error.message}`,
          );
        } else {
          console.log(
            `[OID-DISCOVERY] Walk completed. Found ${availableOids.length} OIDs`,
          );
        }
        resolve(availableOids);
      },
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      session.close();
      console.log(
        `[OID-DISCOVERY] Discovery timeout. Found ${availableOids.length} OIDs`,
      );
      resolve(availableOids);
    }, 30000);
  });
};

export const clearExpiredCache = (): void => {
  const now = Date.now();

  // Clear expired OID cache entries
  for (const [key, entry] of Array.from(oidCache.entries())) {
    if (now - entry.timestamp > CACHE_TTL) {
      oidCache.delete(key);
    }
  }

  // Clear expired failed device cache entries
  for (const [key, entry] of Array.from(failedDeviceCache.entries())) {
    if (now - entry.timestamp > FAILED_DEVICE_TTL) {
      failedDeviceCache.delete(key);
    }
  }

  // Cache cleared
};

// Function to intelligently detect and cache best OIDs for a Huawei device
export const detectAndCacheBestHuaweiOids = async (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<{
  cpu: string | null;
  ramTotal: string | null;
  ramUsed: string | null;
}> => {
  // Starting OID auto-detection

  const cacheKey = getCacheKey(ipAddress, vendor);
  const bestOids = {
    cpu: null as string | null,
    ramTotal: null as string | null,
    ramUsed: null as string | null,
  };

  // Test CPU OIDs with scoring
  const cpuOids = SNMP_OIDS.huawei.cpu;
  let bestCpuScore = 0;

  for (const oid of cpuOids) {
    try {
      const result = await trySpecificCpuOid(ipAddress, community, oid, vendor);
      if (result !== null && result > 0 && result <= 100) {
        // Score based on reasonableness of value and OID preference
        let score = 100;
        if (oid.includes("1.3.6.1.2.1.25.3.3.1.2")) score += 50; // Prefer standard hrProcessorLoad
        if (oid.includes("2011.5.25.31.1.1.1.1.5")) score += 30; // Huawei entity MIB
        if (result > 0 && result < 90) score += 20; // Realistic CPU values

        // CPU OID tested successfully

        if (score > bestCpuScore) {
          bestCpuScore = score;
          bestOids.cpu = oid;
        }
      }
    } catch (error) {
      // Continue testing other OIDs
    }
  }

  // Test RAM OID pairs with scoring
  const ramTotalOids = SNMP_OIDS.huawei.ram.total;
  const ramUsedOids = SNMP_OIDS.huawei.ram.used;
  let bestRamScore = 0;

  for (const totalOid of ramTotalOids) {
    for (const usedOid of ramUsedOids) {
      try {
        const result = await trySpecificRamOids(
          ipAddress,
          community,
          totalOid,
          usedOid,
          vendor,
        );
        if (result !== null && result > 0 && result <= 100) {
          // Score based on reasonableness and OID preference
          let score = 100;
          if (
            totalOid.includes("1.3.6.1.2.1.25.2.3.1.5") &&
            usedOid.includes("1.3.6.1.2.1.25.2.3.1.6")
          ) {
            score += 50; // Prefer standard hrStorage
          }
          if (
            totalOid.includes("2011.5.25.31.1.1.1.1.7") &&
            usedOid.includes("2011.5.25.31.1.1.1.1.8")
          ) {
            score += 30; // Huawei entity MIB
          }
          if (result > 5 && result < 95) score += 20; // Realistic RAM values

          // Check if indices match
          const totalIndex = totalOid.split(".").pop();
          const usedIndex = usedOid.split(".").pop();
          if (totalIndex === usedIndex) score += 40;

          // RAM OID pair tested successfully

          if (score > bestRamScore) {
            bestRamScore = score;
            bestOids.ramTotal = totalOid;
            bestOids.ramUsed = usedOid;
          }
        }
      } catch (error) {
        // Continue testing other pairs
      }
    }
  }

  // Cache the best OIDs found
  if (bestOids.cpu || (bestOids.ramTotal && bestOids.ramUsed)) {
    const cacheEntry = {
      timestamp: Date.now(),
      ttl: CACHE_TTL,
      workingOids: {
        cpu: bestOids.cpu || undefined,
        ramTotal: bestOids.ramTotal || undefined,
        ramUsed: bestOids.ramUsed || undefined,
      },
      failedOids: {
        cpu: [],
        ramTotal: [],
        ramUsed: [],
      },
    };
    oidCache.set(cacheKey, cacheEntry);

    // Best OIDs cached for device
  }

  return bestOids;
};

// Test function to manually check individual Huawei OIDs
export const testHuaweiOids = async (
  ipAddress: string,
  community: string,
): Promise<{ cpuOids: string[]; ramOids: string[]; workingOids: string[] }> => {
  console.log(`[TEST] Starting manual OID test for Huawei device ${ipAddress}`);

  const session = snmp.createSession(ipAddress, community, {
    timeout: 8000, // Increased timeout for CE6860 compatibility
    retries: 0, // No retries to avoid duplicate requests
    version: snmp.Version2c, // Ensure we use SNMPv2c
  });

  const cpuOids = SNMP_OIDS.huawei.cpu;
  const ramTotalOids = SNMP_OIDS.huawei.ram.total;
  const ramUsedOids = SNMP_OIDS.huawei.ram.used;
  const workingOids: string[] = [];

  // Test CPU OIDs
  console.log(`[TEST] Testing ${cpuOids.length} CPU OIDs...`);
  for (const oid of cpuOids) {
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
            const value = varbinds[0].value;
            console.log(
              `[TEST] ✅ CPU OID ${oid} returned: ${value} (type: ${typeof value})`,
            );
            workingOids.push(`CPU: ${oid} = ${value}`);
            resolve(value);
          } else {
            reject(new Error("No data"));
          }
        });
      });
    } catch (error) {
      console.log(`[TEST] ❌ CPU OID ${oid} failed: ${error}`);
    }
  }

  // Test RAM OIDs in pairs
  console.log(`[TEST] Testing RAM OID pairs...`);
  for (const totalOid of ramTotalOids) {
    for (const usedOid of ramUsedOids) {
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
              const totalValue = varbinds[0].value;
              const usedValue = varbinds[1].value;
              console.log(
                `[TEST] ✅ RAM OID pair ${totalOid} = ${totalValue}, ${usedOid} = ${usedValue}`,
              );
              workingOids.push(
                `RAM: ${totalOid} = ${totalValue}, ${usedOid} = ${usedValue}`,
              );
              resolve({ total: totalValue, used: usedValue });
            } else {
              reject(new Error("Incomplete data"));
            }
          });
        });
      } catch (error) {
        // Don't log every failure for RAM pairs as there are many combinations
      }
    }
  }

  session.close();

  console.log(
    `[TEST] Test completed. Found ${workingOids.length} working OIDs.`,
  );

  return {
    cpuOids,
    ramOids: [...ramTotalOids, ...ramUsedOids],
    workingOids,
  };
};

export const fetchSystemUsage = async (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<{ cpuUsage: number | null; ramUsage: number | null }> => {
  console.log(
    `[SYSTEM-USAGE] 🚀 Starting system usage monitoring for ${ipAddress} (vendor: ${vendor})`,
  );
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

    const result = await Promise.race([fetchPromise, timeoutPromise]);

    console.log(
      `[SYSTEM-USAGE] 📊 Completed system usage monitoring for ${ipAddress} (vendor: ${vendor}) - CPU: ${result.cpuUsage}%, RAM: ${result.ramUsage}%`,
    );

    return result;
  } catch (error) {
    console.error(
      `[SYSTEM-USAGE] ❌ Error fetching system usage for ${ipAddress} (vendor: ${vendor}):`,
      error,
    );
    markDeviceAsFailed(ipAddress);
    return { cpuUsage: null, ramUsage: null };
  }
};
