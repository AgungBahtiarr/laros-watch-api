import * as snmp from "net-snmp";

// Function to get cache key
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

// SNMP OIDs for CPU and RAM monitoring by vendor with fallback options
const SNMP_OIDS = {
  mikrotik: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index (should return percentage) - PRIORITY OID
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.65536", // hrStorageSize common RAM index - PRIORITY OID
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.65536", // hrStorageUsed common RAM index - PRIORITY OID
      ],
    },
  },
  juniper: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1", // hrProcessorLoad with index - PRIORITY OID
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1", // hrStorageSize - PRIORITY OID
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1", // hrStorageUsed - PRIORITY OID
      ],
    },
  },
  huawei: {
    cpu: [
      "1.3.6.1.4.1.2011.6.3.4.1.2.1.1.0", // hwCpuCurrentUsage - CONFIRMED WORKING (11%) - FIRST PRIORITY
    ],
    ram: {
      total: [
        "1.3.6.1.4.1.2011.6.3.5.1.1.2.1.1.0", // hwMemorySize - CONFIRMED WORKING (2033782784 bytes) - FIRST PRIORITY
        "1.3.6.1.4.1.2011.6.3.5.1.1.8.1.1.0", // hwMemoryTotal alt - CONFIRMED WORKING (2033782784 bytes)
      ],
      used: [
        "1.3.6.1.4.1.2011.6.3.5.1.1.3.1.1.0", // hwMemoryUsed - CONFIRMED WORKING (973664256 bytes) - FIRST PRIORITY
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

export const fetchCpuUsage = (
  ipAddress: string,
  community: string,
  vendor: string,
): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const oids =
      SNMP_OIDS[vendor as keyof typeof SNMP_OIDS] || SNMP_OIDS.generic;
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
    const oids =
      SNMP_OIDS[vendor as keyof typeof SNMP_OIDS] || SNMP_OIDS.generic;
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
    console.log(`[SNMP-TEST] SNMPv1 works: ${testResult}`);
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
    console.log(`[SNMP-TEST] SNMPv2c works: ${testResult}`);
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

// Helper function to parse port bitmap and return interface names
const parsePortBitmap = (
  bitmap: Buffer,
  interfaceNames: Map<number, string>,
): string[] => {
  const ports: string[] = [];

  try {
    for (let byteIndex = 0; byteIndex < bitmap.length; byteIndex++) {
      const byte = bitmap[byteIndex];
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        if (byte & (1 << (7 - bitIndex))) {
          const portIndex = byteIndex * 8 + bitIndex + 1; // Port indices usually start from 1
          const interfaceName = interfaceNames.get(portIndex);
          if (interfaceName) {
            ports.push(interfaceName);
          } else if (portIndex <= 64) {
            // Only include reasonable port numbers
            ports.push(`port-${portIndex}`);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`[ROUTEROS-VLAN] Error parsing port bitmap:`, error);
  }

  return ports;
};

// Helper function to get interface name from port number for MikroTik
const getMikroTikInterfaceName = (
  portNumber: number,
  interfaceNames: Map<number, string>,
): string => {
  // MikroTik port mapping based on actual SNMP data:
  // Port 0 = bridge1 (index 6)
  // Port 1 = ether1 (index 1)
  // Port 2 = sfp-sfpplus1 (index 2)
  // Port 3 = sfp-sfpplus2 (index 3)
  // Port 4 = sfp-sfpplus3 (index 4)
  // Port 5+ = sfp-sfpplus4+ (index 5+)

  const portToInterfaceMap: { [key: number]: number } = {
    0: 6, // bridge1
    1: 1, // ether1
    2: 2, // sfp-sfpplus1
    3: 3, // sfp-sfpplus2
    4: 4, // sfp-sfpplus3
    5: 5, // sfp-sfpplus4
  };

  const interfaceIndex = portToInterfaceMap[portNumber];
  if (interfaceIndex && interfaceNames.has(interfaceIndex)) {
    return interfaceNames.get(interfaceIndex)!;
  }

  // Fallback to direct lookup
  if (interfaceNames.has(portNumber)) {
    return interfaceNames.get(portNumber)!;
  }

  return `port-${portNumber}`;
};

export const fetchRouterOSVlans = (
  ipAddress: string,
  community: string,
  dbInterfaces?: any[],
): Promise<any[]> => {
  console.log(`[ROUTEROS-VLAN] Fetching VLAN data for ${ipAddress}`);

  return new Promise(async (resolve, reject) => {
    const session = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 12000,
      retries: 1,
    });

    // Set up timeout handler
    const timeoutId = setTimeout(() => {
      session.close();
      console.warn(
        `[ROUTEROS-VLAN] Timeout fetching VLAN data from ${ipAddress}`,
      );
      resolve([]);
    }, 18000);

    const vlanData: any[] = [];
    const interfaceNames = new Map<number, string>();
    const bridgePortTable = new Map<string, number>(); // MAC to Port mapping

    try {
      console.log(
        `[ROUTEROS-VLAN] Step 1: Getting interface names for ${ipAddress}`,
      );

      // Get all interface names using SNMP table walk
      await new Promise<void>((resolveWalk) => {
        session.table("1.3.6.1.2.1.2.2.1", (error: any, tableData: any) => {
          if (error) {
            console.warn(
              `[ROUTEROS-VLAN] Interface table error: ${error.message}`,
            );
          } else if (tableData) {
            Object.entries(tableData).forEach(
              ([index, columns]: [string, any]) => {
                const ifIndex = parseInt(index);
                const ifName = safeToString(columns["2"]); // ifName column
                const ifDescr = safeToString(columns["3"]); // ifDescr column

                if (ifName) {
                  interfaceNames.set(ifIndex, ifName);
                } else if (ifDescr) {
                  interfaceNames.set(ifIndex, ifDescr);
                }
              },
            );
          }
          resolveWalk();
        });
      });

      console.log(`[ROUTEROS-VLAN] Found ${interfaceNames.size} interfaces`);
      console.log(
        `[ROUTEROS-VLAN] Interface mapping:`,
        Object.fromEntries(interfaceNames),
      );

      console.log(
        `[ROUTEROS-VLAN] Step 2: Getting MikroTik VLAN data using specific table`,
      );

      // Use MikroTik-specific VLAN table based on SNMP walk results
      await new Promise<void>((resolveWalk) => {
        session.table(
          "1.3.6.1.2.1.17.7.1.2.2.1",
          (error: any, tableData: any) => {
            if (error) {
              console.warn(
                `[ROUTEROS-VLAN] MikroTik VLAN table error: ${error.message}`,
              );
            } else if (tableData && Object.keys(tableData).length > 0) {
              console.log(
                `[ROUTEROS-VLAN] Found ${Object.keys(tableData).length} VLAN entries`,
              );

              const parsedVlans = parseMikroTikVlanTableDynamic(
                tableData,
                interfaceNames,
                dbInterfaces,
              );
              vlanData.push(...parsedVlans);

              console.log(
                `[ROUTEROS-VLAN] Parsed ${parsedVlans.length} VLANs from MikroTik table`,
              );
            } else {
              console.log(
                `[ROUTEROS-VLAN] MikroTik VLAN table returned no data`,
              );
            }
            resolveWalk();
          },
        );
      });

      // If no VLANs found with table approach, try bridge VLAN static table
      if (vlanData.length === 0) {
        console.log(`[ROUTEROS-VLAN] Step 4: Trying Bridge VLAN Static Table`);

        await new Promise<void>((resolveWalk) => {
          session.table(
            "1.3.6.1.2.1.17.7.1.4.5.1",
            (error: any, tableData: any) => {
              if (error) {
                console.warn(
                  `[ROUTEROS-VLAN] Bridge VLAN Static error: ${error.message}`,
                );
              } else if (tableData && Object.keys(tableData).length > 0) {
                const parsedVlans = parseBridgeVlanStaticTableMikroTik(
                  tableData,
                  interfaceNames,
                );
                vlanData.push(...parsedVlans);
                console.log(
                  `[ROUTEROS-VLAN] Bridge VLAN Static found ${parsedVlans.length} VLANs`,
                );
              }
              resolveWalk();
            },
          );
        });
      }

      console.log(
        `[ROUTEROS-VLAN] Successfully found ${vlanData.length} VLAN entries for ${ipAddress}`,
      );

      // Log detailed results for debugging
      vlanData.forEach((vlan) => {
        console.log(
          `[ROUTEROS-VLAN] ✅ VLAN ${vlan.vlanId}: Tagged=[${vlan.taggedPorts}], Untagged=[${vlan.untaggedPorts}]`,
        );
      });

      clearTimeout(timeoutId);
      session.close();
      resolve(vlanData);
    } catch (mainError) {
      console.error(`[ROUTEROS-VLAN] Main error for ${ipAddress}:`, mainError);
      clearTimeout(timeoutId);
      session.close();
      resolve([]);
    }

    // Handle session errors
    session.on("error", (err: any) => {
      clearTimeout(timeoutId);
      console.warn(
        `[ROUTEROS-VLAN] Session error for ${ipAddress}: ${err.message || err}`,
      );
      session.close();
      resolve([]);
    });
  });
};

// Dynamic parser that extracts VLANs from SNMP data without hardcoding
const parseMikroTikVlanTableDynamic = (
  tableData: any,
  interfaceNames: Map<number, string>,
  dbInterfaces?: any[],
): any[] => {
  const vlanMap = new Map<number, Set<string>>();

  // Create MAC-to-Interface mapping from database if available
  const macToInterface = new Map<string, string>();
  if (dbInterfaces) {
    dbInterfaces.forEach((iface) => {
      if (iface.ifPhysAddress) {
        const cleanMac = iface.ifPhysAddress.toLowerCase().replace(/[:-]/g, "");
        const formattedMac = cleanMac.match(/.{2}/g)?.join(":");
        if (formattedMac && iface.ifName) {
          macToInterface.set(formattedMac, iface.ifName);
        }
      }
    });
  }

  console.log(
    `[ROUTEROS-VLAN] Processing ${Object.keys(tableData).length} VLAN entries dynamically`,
  );

  // Process the table data - MAC address is the index, VLAN ID is the column key
  Object.entries(tableData).forEach(([macAddress, columns]: [string, any]) => {
    try {
      // Each column key is a VLAN ID, column value is the MAC address
      Object.keys(columns).forEach((vlanIdStr) => {
        const vlanId = parseInt(vlanIdStr);
        if (!isNaN(vlanId) && vlanId > 0 && vlanId !== 1 && vlanId !== 99) {
          if (!vlanMap.has(vlanId)) {
            vlanMap.set(vlanId, new Set<string>());
          }

          // Try to find which interface this MAC belongs to
          const macHex = safeToString(columns[vlanIdStr], "hex");
          let interfaceName: string | null = null;

          // Method 1: Use database MAC-to-Interface mapping (most accurate)
          if (macHex && macToInterface.has(macHex)) {
            interfaceName = macToInterface.get(macHex)!;
          }

          // Method 2: Try direct MAC address matching from macAddress index
          if (!interfaceName) {
            const indexMac = macAddress
              .split(".")
              .map((part) => parseInt(part).toString(16).padStart(2, "0"))
              .join(":");

            if (macToInterface.has(indexMac)) {
              interfaceName = macToInterface.get(indexMac)!;
            }
          }

          // Method 3: Use interface names for common interface patterns
          if (!interfaceName) {
            // Look for interfaces that are likely to have VLANs
            for (const [ifIndex, ifName] of interfaceNames.entries()) {
              if (
                ifName &&
                (ifName.includes("sfp") ||
                  ifName.includes("ether") ||
                  ifName.includes("bridge"))
              ) {
                // For devices without specific MAC mapping, include all valid interfaces
                vlanMap.get(vlanId)!.add(ifName);
              }
            }
          } else {
            vlanMap.get(vlanId)!.add(interfaceName);
          }
        }
      });
    } catch (error) {
      console.warn(
        `[ROUTEROS-VLAN] Error parsing VLAN entry ${macAddress}:`,
        error,
      );
    }
  });

  // Convert to final VLAN structure
  const vlans: any[] = [];
  vlanMap.forEach((interfaces, vlanId) => {
    if (interfaces.size > 0) {
      const interfaceList = Array.from(interfaces);

      vlans.push({
        vlanId,
        name: `VLAN-${vlanId}`,
        description: `VLAN ${vlanId}`,
        taggedPorts: interfaceList.join(","), // Default to tagged
        untaggedPorts: "", // Would need additional SNMP data to determine
        tableUsed: "Dynamic SNMP Analysis",
      });

      console.log(
        `[ROUTEROS-VLAN] VLAN ${vlanId}: interfaces [${interfaceList.join(", ")}]`,
      );
    }
  });

  return vlans;
};

// Helper function to enhance VLAN parsing with additional SNMP data
const enhanceVlanDataWithBridgeInfo = async (
  session: any,
  vlanMap: Map<number, any>,
  interfaceNames: Map<number, string>,
): Promise<void> => {
  console.log(`[ROUTEROS-VLAN] Enhancing VLAN data with bridge port info`);

  try {
    // Try to get more detailed bridge VLAN information
    await new Promise<void>((resolve) => {
      session.table(
        "1.3.6.1.2.1.17.7.1.2.2.1",
        (error: any, tableData: any) => {
          if (!error && tableData) {
            // Additional processing for tagged/untagged determination
            // This can be expanded based on specific SNMP MIB data available
            console.log(
              `[ROUTEROS-VLAN] Bridge VLAN detail table has ${Object.keys(tableData).length} entries`,
            );
          }
          resolve();
        },
      );
    });
  } catch (error) {
    console.warn(`[ROUTEROS-VLAN] Could not enhance VLAN data:`, error);
  }
};

// Parser for Bridge VLAN Static Table (MikroTik specific)
const parseBridgeVlanStaticTableMikroTik = (
  tableData: any,
  interfaceNames: Map<number, string>,
): any[] => {
  const vlans: any[] = [];

  // Based on SNMP walk results, we have entries like:
  // SNMPv2-SMI::mib-2.17.7.1.4.5.1.1.1 = Gauge32: 1
  // SNMPv2-SMI::mib-2.17.7.1.4.5.1.1.2 = Gauge32: 1
  // SNMPv2-SMI::mib-2.17.7.1.4.5.1.1.3 = Gauge32: 117
  // SNMPv2-SMI::mib-2.17.7.1.4.5.1.1.4 = Gauge32: 108

  const vlanEntries = new Map<string, any>();

  Object.entries(tableData).forEach(([index, columns]: [string, any]) => {
    try {
      const entryIndex = parseInt(index);
      if (!isNaN(entryIndex)) {
        // Column 1 = VLAN ID, Column 2 = Type, Column 3 = Status
        const vlanId = parseInt(safeToString(columns["1"]) || "0");
        const portType = parseInt(safeToString(columns["2"]) || "0");
        const status = parseInt(safeToString(columns["3"]) || "0");

        if (vlanId > 0 && status === 1) {
          const entryKey = `${vlanId}`;

          if (!vlanEntries.has(entryKey)) {
            vlanEntries.set(entryKey, {
              vlanId,
              taggedPorts: new Set<string>(),
              untaggedPorts: new Set<string>(),
            });
          }

          const vlan = vlanEntries.get(entryKey)!;
          const interfaceName = getMikroTikInterfaceName(
            entryIndex - 1,
            interfaceNames,
          );

          // portType: 1 = untagged, 2 = tagged
          if (portType === 1) {
            vlan.untaggedPorts.add(interfaceName);
          } else if (portType === 2) {
            vlan.taggedPorts.add(interfaceName);
          }
        }
      }
    } catch (error) {
      console.warn(
        `[ROUTEROS-VLAN] Error parsing bridge static entry ${index}:`,
        error,
      );
    }
  });

  // Convert to array
  vlanEntries.forEach((vlan, vlanId) => {
    if (vlan.taggedPorts.size > 0 || vlan.untaggedPorts.size > 0) {
      vlans.push({
        vlanId: vlan.vlanId,
        name: `VLAN-${vlan.vlanId}`,
        description: `VLAN ${vlan.vlanId}`,
        taggedPorts: Array.from(vlan.taggedPorts).join(","),
        untaggedPorts: Array.from(vlan.untaggedPorts).join(","),
        tableUsed: "Bridge VLAN Static Table (MikroTik)",
      });
    }
  });

  return vlans;
};

// Update community string in the function to use the correct one
export const updateSnmpCommunity = () => {
  // This function can be used to update the default community string
  // The actual community string "laros999" should be stored in database or config
  return "laros999";
};

// Test function to verify VLAN parsing with actual device
export const testRouterOSVlansSync = async (
  ipAddress: string,
  community: string,
): Promise<{ success: boolean; message: string; data?: any[] }> => {
  console.log(`[VLAN-TEST] Starting VLAN test for ${ipAddress}`);

  try {
    const vlanData = await fetchRouterOSVlans(ipAddress, community);

    if (vlanData.length === 0) {
      return {
        success: false,
        message: `No VLAN data found for ${ipAddress}. Device may not have VLANs configured or SNMP access issues.`,
      };
    }

    console.log(
      `[VLAN-TEST] Successfully parsed ${vlanData.length} VLANs from ${ipAddress}`,
    );

    // Log detailed results for debugging
    vlanData.forEach((vlan) => {
      console.log(
        `[VLAN-TEST] VLAN ${vlan.vlanId}: Tagged=[${vlan.taggedPorts}], Untagged=[${vlan.untaggedPorts}]`,
      );
    });

    return {
      success: true,
      message: `Successfully parsed ${vlanData.length} VLANs`,
      data: vlanData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[VLAN-TEST] Test failed for ${ipAddress}: ${errorMessage}`);

    return {
      success: false,
      message: `VLAN test failed: ${errorMessage}`,
    };
  }
};
