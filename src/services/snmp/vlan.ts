import * as snmp from "net-snmp";
import { safeToString } from "./utils";
import genericOids from "../../config/generic/oids.json";
import routerosOids from "../../config/routeros/oids.json";

// New function to fetch MikroTik bridge VLAN data using direct OID walks
export const fetchMikroTikBridgeVlans = (
  ipAddress: string,
  community: string,
  dbInterfaces: any[],
): Promise<any[]> => {
  console.log(
    `[MIKROTIK-BRIDGE-VLAN] Fetching bridge VLAN data for ${ipAddress}`,
  );

  return new Promise(async (resolve, reject) => {
    const session = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 8000,
      retries: 2,
    });

    // Set up timeout handler
    const timeoutId = setTimeout(() => {
      try {
        if (session && session.dgram) {
          session.close();
        }
      } catch (closeError) {
        console.warn(
          `[MIKROTIK-BRIDGE-VLAN] Error closing session: ${closeError}`,
        );
      }
      console.warn(`[MIKROTIK-BRIDGE-VLAN] Timeout for ${ipAddress}`);
      resolve([]);
    }, 25000);

    try {
      const vlanData: any[] = [];
      const bridgeVlans = new Set<number>(); // Store unique VLAN IDs
      const untaggedVlans = new Map<number, number>(); // ifIndex -> vlanId

      // Create interface mapping from database interfaces
      const interfaceMap = new Map<number, any>();
      if (dbInterfaces && dbInterfaces.length > 0) {
        console.log(`[MIKROTIK-BRIDGE-VLAN] Interface mapping from database:`);
        dbInterfaces.forEach((iface) => {
          interfaceMap.set(iface.ifIndex, iface);
          console.log(
            `  ifIndex ${iface.ifIndex} → ${iface.ifName} (id: ${iface.id})`,
          );
        });
      } else {
        console.log(
          `[MIKROTIK-BRIDGE-VLAN] No interface data provided for mapping`,
        );
      }

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] Step 1: Getting bridge VLAN data using OID 1.3.6.1.2.1.17.7.1.2.2.1`,
      );

      // Walk bridge VLAN table to get all VLAN IDs
      await new Promise<void>((resolveWalk) => {
        try {
          session.subtree(
            "1.3.6.1.2.1.17.7.1.2.2.1",
            (varbinds: any[]) => {
              if (varbinds) {
                varbinds.forEach((vb) => {
                  if (!snmp.isVarbindError(vb)) {
                    // Parse VLAN ID from OID
                    // Format: 1.3.6.1.2.1.17.7.1.2.2.1.1.<vlanId>.<mac_bytes>
                    const oidParts = vb.oid.split(".");

                    // Base OID: 1.3.6.1.2.1.17.7.1.2.2.1.1 (13 parts)
                    // VLAN ID is at index 13 (14th part)
                    if (oidParts.length >= 14) {
                      const vlanId = parseInt(oidParts[13]);

                      if (!isNaN(vlanId) && vlanId > 0) {
                        bridgeVlans.add(vlanId);
                      }
                    }
                  }
                });
              }
            },
            (error: any) => {
              if (error) {
                console.warn(
                  `[MIKROTIK-BRIDGE-VLAN] Bridge VLAN walk error: ${error.message}`,
                );
              }
              console.log(
                `[MIKROTIK-BRIDGE-VLAN] Found ${bridgeVlans.size} unique VLANs: ${Array.from(bridgeVlans).join(", ")}`,
              );
              resolveWalk();
            },
          );
        } catch (walkError) {
          console.warn(
            `[MIKROTIK-BRIDGE-VLAN] Failed to start bridge VLAN walk: ${walkError}`,
          );
          resolveWalk();
        }
      });

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] Step 2: Getting untagged VLAN data using OID 1.3.6.1.2.1.17.7.1.4.5.1.1`,
      );

      // Walk untagged VLAN table to get port-to-VLAN mappings
      await new Promise<void>((resolveWalk) => {
        try {
          session.subtree(
            "1.3.6.1.2.1.17.7.1.4.5.1.1",
            (varbinds: any[]) => {
              if (varbinds) {
                varbinds.forEach((vb) => {
                  if (!snmp.isVarbindError(vb)) {
                    // Parse ifIndex and VLAN ID from OID and value
                    // Format: 1.3.6.1.2.1.17.7.1.4.5.1.1.<ifIndex> = <vlanId>
                    const oidParts = vb.oid.split(".");

                    // Base OID: 1.3.6.1.2.1.17.7.1.4.5.1.1 (12 parts)
                    // Only process OIDs that match exactly with our base + 1 additional part
                    const baseOid = "1.3.6.1.2.1.17.7.1.4.5.1.1";
                    const baseOidParts = baseOid.split(".");

                    if (
                      oidParts.length === baseOidParts.length + 1 &&
                      oidParts.slice(0, baseOidParts.length).join(".") ===
                        baseOid
                    ) {
                      const ifIndex = parseInt(oidParts[baseOidParts.length]);
                      const vlanId = parseInt(vb.value || "0");

                      // Check if ifIndex exists in database interfaces
                      const interfaceExists = interfaceMap.has(ifIndex);

                      if (
                        !isNaN(ifIndex) &&
                        !isNaN(vlanId) &&
                        vlanId > 0 &&
                        vlanId !== 1 &&
                        vlanId !== 99 &&
                        interfaceExists
                      ) {
                        untaggedVlans.set(ifIndex, vlanId);
                        const iface = interfaceMap.get(ifIndex);
                        console.log(
                          `[MIKROTIK-BRIDGE-VLAN] ✅ ifIndex ${ifIndex} (${iface.ifName}) is untagged for VLAN ${vlanId}`,
                        );
                      } else if (vlanId === 1 || vlanId === 99) {
                        const iface = interfaceMap.get(ifIndex);
                        const interfaceName = iface
                          ? iface.ifName
                          : `if${ifIndex}`;
                        console.log(
                          `[MIKROTIK-BRIDGE-VLAN] ⚠️ Skipping ifIndex ${ifIndex} (${interfaceName}) VLAN ${vlanId} (excluded from sync)`,
                        );
                      } else if (!interfaceExists) {
                        console.log(
                          `[MIKROTIK-BRIDGE-VLAN] ⚠️ Skipping ifIndex ${ifIndex} VLAN ${vlanId} (interface not found in database)`,
                        );
                      }
                    }
                  }
                });
              }
            },
            (error: any) => {
              if (error) {
                console.warn(
                  `[MIKROTIK-BRIDGE-VLAN] Untagged VLAN walk error: ${error.message}`,
                );
              }
              console.log(
                `[MIKROTIK-BRIDGE-VLAN] Found ${untaggedVlans.size} untagged port mappings`,
              );
              resolveWalk();
            },
          );
        } catch (walkError) {
          console.warn(
            `[MIKROTIK-BRIDGE-VLAN] Failed to start untagged VLAN walk: ${walkError}`,
          );
          resolveWalk();
        }
      });

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] Step 3: Building VLAN data structure`,
      );

      // Build VLAN data structure from all discovered VLANs
      const allVlans = new Set<number>();

      // Add VLANs from bridge table, excluding VLAN 1 and 99
      bridgeVlans.forEach((vlanId) => {
        if (vlanId !== 1 && vlanId !== 99) {
          allVlans.add(vlanId);
        }
      });

      // Add VLANs from untagged table, excluding VLAN 1 and 99
      untaggedVlans.forEach((vlanId) => {
        if (vlanId !== 1 && vlanId !== 99) {
          allVlans.add(vlanId);
        }
      });

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] All discovered VLANs (excluding VLAN 1 and 99): ${Array.from(
          allVlans,
        )
          .sort((a, b) => a - b)
          .join(", ")}`,
      );

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] Untagged VLAN mappings: ${Array.from(
          untaggedVlans.entries(),
        )
          .map(([ifIndex, vlanId]) => `${ifIndex}→${vlanId}`)
          .join(", ")}`,
      );

      Array.from(allVlans).forEach((vlanId) => {
        const taggedPorts: string[] = [];
        const untaggedPorts: string[] = [];

        // Find untagged ports for this VLAN
        untaggedVlans.forEach((portVlanId, ifIndex) => {
          if (portVlanId === vlanId) {
            const iface = interfaceMap.get(ifIndex);
            if (iface && iface.ifName) {
              untaggedPorts.push(iface.ifName);
              console.log(
                `[MIKROTIK-BRIDGE-VLAN] ✓ VLAN ${vlanId}: mapped ifIndex ${ifIndex} → ${iface.ifName}`,
              );
            } else {
              // If no interface mapping available, use generic name
              const genericName = `if${ifIndex}`;
              untaggedPorts.push(genericName);
              console.log(
                `[MIKROTIK-BRIDGE-VLAN] ⚠️ VLAN ${vlanId}: ifIndex ${ifIndex} → ${genericName} (no interface data)`,
              );
            }
          }
        });

        // For now, we assume all other ports with this VLAN are tagged
        // In a more complete implementation, you would walk additional OIDs to get tagged port info

        vlanData.push({
          vlanId: vlanId,
          taggedPorts: taggedPorts.join(","),
          untaggedPorts: untaggedPorts.join(","),
          comment: `VLAN-${vlanId}`,
        });
      });

      clearTimeout(timeoutId);
      try {
        if (session && session.dgram) {
          session.close();
        }
      } catch (closeError) {
        // Ignore close errors
      }

      console.log(
        `[MIKROTIK-BRIDGE-VLAN] Successfully fetched ${vlanData.length} VLANs for ${ipAddress}`,
      );
      resolve(vlanData);
    } catch (error) {
      clearTimeout(timeoutId);
      try {
        if (session && session.dgram) {
          session.close();
        }
      } catch (closeError) {
        // Ignore close errors
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[MIKROTIK-BRIDGE-VLAN] Error fetching VLAN data for ${ipAddress}: ${errorMessage}`,
      );
      reject(error);
    }
  });
};

// Helper function to get interface name from port number using database interface data
// MikroTik has an offset in port indexing: SNMP port index + 1 = actual ifIndex
const getInterfaceNameFromPortIndex = (
  portIndex: number,
  dbInterfaces?: any[],
  snmpInterfaceNames?: Map<number, string>,
): string => {
  console.log(
    `[ROUTEROS-VLAN] Looking for interface with portIndex: ${portIndex}`,
  );

  // Method 1: Use database interfaces with ifIndex matching
  // For MikroTik: SNMP port index maps to ifIndex with +1 offset
  if (dbInterfaces && dbInterfaces.length > 0) {
    console.log(
      `[ROUTEROS-VLAN] Searching in ${dbInterfaces.length} database interfaces`,
    );

    // For MikroTik, always use +1 offset first
    let matchingInterface = dbInterfaces.find(
      (iface) => iface.ifIndex === portIndex + 1,
    );

    if (matchingInterface) {
      console.log(
        `[ROUTEROS-VLAN] Found DB match with +1 offset: portIndex ${portIndex} -> ifIndex ${portIndex + 1} -> ${matchingInterface.ifName}`,
      );
      return matchingInterface.ifName;
    }

    // Fallback to direct mapping if +1 offset fails
    matchingInterface = dbInterfaces.find(
      (iface) => iface.ifIndex === portIndex,
    );

    if (matchingInterface && matchingInterface.ifName) {
      console.log(
        `[ROUTEROS-VLAN] Found DB match (direct fallback): portIndex ${portIndex} -> ${matchingInterface.ifName}`,
      );
      return matchingInterface.ifName;
    } else {
      console.log(
        `[ROUTEROS-VLAN] No DB match found for portIndex ${portIndex} (tried +1 offset and direct)`,
      );
    }
  } else {
    console.log(`[ROUTEROS-VLAN] No database interfaces provided`);
  }

  // Method 2: Use SNMP interface names map
  if (snmpInterfaceNames && snmpInterfaceNames.has(portIndex)) {
    const snmpName = snmpInterfaceNames.get(portIndex)!;
    console.log(
      `[ROUTEROS-VLAN] Found SNMP match: portIndex ${portIndex} -> ${snmpName}`,
    );
    return snmpName;
  } else {
    console.log(
      `[ROUTEROS-VLAN] No SNMP match found for portIndex ${portIndex}`,
    );
  }

  // Method 3: Fallback to generic port naming
  const fallbackName = `port-${portIndex}`;
  console.log(`[ROUTEROS-VLAN] Using fallback name: ${fallbackName}`);
  return fallbackName;
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
      try {
        if (session.dgram) {
          session.close();
        }
      } catch (closeError) {
        console.warn(
          `[ROUTEROS-VLAN] Error closing session on timeout: ${closeError}`,
        );
      }
      console.warn(
        `[ROUTEROS-VLAN] Timeout fetching VLAN data from ${ipAddress}`,
      );
      resolve([]);
    }, 18000);

    const vlanData: any[] = [];
    const interfaceNames = new Map<number, string>();
    const untaggedVlanMap = new Map<number, number>(); // port index -> vlan id

    try {
      console.log(
        `[ROUTEROS-VLAN] Step 1: Getting interface names for ${ipAddress}`,
      );

      // Get all interface names using SNMP table walk
      await new Promise<void>((resolveWalk) => {
        session.table(genericOids.ifTable, (error: any, tableData: any) => {
          if (error) {
            console.warn(
              `[ROUTEROS-VLAN] Interface table error: ${error.message}`,
            );
            console.warn(`[ROUTEROS-VLAN] OID used: ${genericOids.ifTable}`);
          } else if (tableData) {
            console.log(
              `[ROUTEROS-VLAN] Raw interface table data:`,
              JSON.stringify(Object.keys(tableData), null, 2),
            );
            Object.entries(tableData).forEach(
              ([index, columns]: [string, any]) => {
                const ifIndex = parseInt(index);
                const ifName = safeToString(columns["2"]); // ifName column
                const ifDescr = safeToString(columns["3"]); // ifDescr column

                console.log(
                  `[ROUTEROS-VLAN] Interface ${index}: ifName=${ifName}, ifDescr=${ifDescr}`,
                );

                if (ifName) {
                  interfaceNames.set(ifIndex, ifName);
                } else if (ifDescr) {
                  interfaceNames.set(ifIndex, ifDescr);
                }
              },
            );
          } else {
            console.warn(`[ROUTEROS-VLAN] Interface table returned no data`);
          }
          resolveWalk();
        });
      });

      console.log(
        `[ROUTEROS-VLAN] Found ${interfaceNames.size} interfaces from SNMP`,
      );
      console.log(
        `[ROUTEROS-VLAN] SNMP Interface mapping:`,
        Array.from(interfaceNames.entries()).reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {} as any),
      );

      // Log database interfaces for comparison
      if (dbInterfaces && dbInterfaces.length > 0) {
        console.log(
          `[ROUTEROS-VLAN] Found ${dbInterfaces.length} interfaces from database:`,
        );
        dbInterfaces.forEach((iface) => {
          console.log(`  ifIndex: ${iface.ifIndex}, ifName: ${iface.ifName}`);
        });
      } else {
        console.log(`[ROUTEROS-VLAN] No database interfaces provided`);
      }

      console.log(
        `[ROUTEROS-VLAN] Step 2: Getting untagged VLAN data using OID 1.3.6.1.2.1.17.7.1.4.5.1.1`,
      );

      // Get untagged VLAN data using the specific OID for PVID (Port VLAN ID)
      console.log(
        `[ROUTEROS-VLAN] Attempting to walk OID: 1.3.6.1.2.1.17.7.1.4.5.1.1`,
      );
      await new Promise<void>((resolveWalk) => {
        // Use get() for specific OIDs to avoid walking entire subtree
        const untaggedOids = [
          "1.3.6.1.2.1.17.7.1.4.5.1.1.1",
          "1.3.6.1.2.1.17.7.1.4.5.1.1.2",
          "1.3.6.1.2.1.17.7.1.4.5.1.1.3",
          "1.3.6.1.2.1.17.7.1.4.5.1.1.4",
          "1.3.6.1.2.1.17.7.1.4.5.1.1.5",
        ];

        session.get(untaggedOids, (error: any, varbinds: any[]) => {
          if (error) {
            console.warn(
              `[ROUTEROS-VLAN] Untagged VLAN get error: ${error.message}`,
            );
          } else if (varbinds) {
            console.log(
              `[ROUTEROS-VLAN] Found ${varbinds.length} untagged VLAN entries`,
            );

            varbinds.forEach((vb) => {
              if (snmp.isVarbindError(vb)) {
                console.warn(
                  `[ROUTEROS-VLAN] SNMP error for OID ${vb.oid}: ${vb.value}`,
                );
              } else {
                console.log(
                  `[ROUTEROS-VLAN] OID: ${vb.oid}, Value: ${vb.value}`,
                );

                // Parse OID to get port index
                // OID format: 1.3.6.1.2.1.17.7.1.4.5.1.1.<portIndex>
                const oidParts = vb.oid.split(".");
                const portIndex = parseInt(oidParts[oidParts.length - 1]);
                const vlanId = parseInt(vb.value || "0");

                console.log(
                  `[ROUTEROS-VLAN] Parsed: port ${portIndex}, VLAN ${vlanId}`,
                );

                if (vlanId > 1 && !isNaN(portIndex)) {
                  untaggedVlanMap.set(portIndex, vlanId);
                  const interfaceName = getInterfaceNameFromPortIndex(
                    portIndex,
                    dbInterfaces,
                    interfaceNames,
                  );
                  console.log(
                    `[ROUTEROS-VLAN] ✅ Port ${portIndex} (${interfaceName}) has untagged VLAN ${vlanId}`,
                  );
                } else {
                  console.log(
                    `[ROUTEROS-VLAN] ⚠️ Skipping port ${portIndex} with VLAN ${vlanId} (default VLAN or invalid)`,
                  );
                }
              }
            });
          }

          console.log(
            `[ROUTEROS-VLAN] Final untagged VLAN map:`,
            Array.from(untaggedVlanMap.entries()).reduce(
              (obj, [key, value]) => {
                obj[key] = value;
                return obj;
              },
              {} as any,
            ),
          );

          resolveWalk();
        });
      });

      console.log(
        `[ROUTEROS-VLAN] Step 3: Getting MikroTik VLAN data using specific table`,
      );

      // Use MikroTik-specific VLAN table based on SNMP walk results
      await new Promise<void>((resolveWalk) => {
        session.table(
          routerosOids.vlan.mikrotikVlanTable,
          (error: any, tableData: any) => {
            if (error) {
              console.warn(
                `[ROUTEROS-VLAN] MikroTik VLAN table error: ${error.message}`,
              );
              console.warn(
                `[ROUTEROS-VLAN] OID used: ${routerosOids.vlan.mikrotikVlanTable}`,
              );
            } else if (tableData && Object.keys(tableData).length > 0) {
              console.log(
                `[ROUTEROS-VLAN] Found ${Object.keys(tableData).length} VLAN entries`,
              );
              console.log(
                `[ROUTEROS-VLAN] Sample entries:`,
                JSON.stringify(Object.entries(tableData).slice(0, 3), null, 2),
              );

              const parsedVlans = parseMikroTikVlanTableDynamic(
                tableData,
                interfaceNames,
                untaggedVlanMap,
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
            routerosOids.vlan.bridgeVlanStaticTable,
            (error: any, tableData: any) => {
              if (error) {
                console.warn(
                  `[ROUTEROS-VLAN] Bridge VLAN Static error: ${error.message}`,
                );
              } else if (tableData && Object.keys(tableData).length > 0) {
                const parsedVlans = parseBridgeVlanStaticTableMikroTik(
                  tableData,
                  interfaceNames,
                  dbInterfaces,
                  untaggedVlanMap,
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
      try {
        if (session.dgram) {
          session.close();
        }
      } catch (closeError) {
        console.warn(`[ROUTEROS-VLAN] Error closing session: ${closeError}`);
      }
      resolve(vlanData);
    } catch (mainError) {
      console.error(`[ROUTEROS-VLAN] Main error for ${ipAddress}:`, mainError);
      clearTimeout(timeoutId);
      try {
        if (session.dgram) {
          session.close();
        }
      } catch (closeError) {
        console.warn(`[ROUTEROS-VLAN] Error closing session: ${closeError}`);
      }
      resolve([]);
    }

    // Handle session errors
    session.on("error", (err: any) => {
      clearTimeout(timeoutId);
      console.warn(
        `[ROUTEROS-VLAN] Session error for ${ipAddress}: ${err.message || err}`,
      );
      try {
        if (session.dgram) {
          session.close();
        }
      } catch (closeError) {
        console.warn(`[ROUTEROS-VLAN] Error closing session: ${closeError}`);
      }
      resolve([]);
    });
  });
};

// Dynamic parser that extracts VLANs from SNMP data without hardcoding
const parseMikroTikVlanTableDynamic = (
  tableData: any,
  interfaceNames: Map<number, string>,
  untaggedVlanMap?: Map<number, number>,
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

  // Convert to final VLAN structure with proper tagged/untagged detection
  const vlans: any[] = [];
  vlanMap.forEach((interfaces, vlanId) => {
    if (interfaces.size > 0) {
      const interfaceList = Array.from(interfaces);
      const taggedPorts: string[] = [];
      const untaggedPorts: string[] = [];

      // Separate tagged and untagged ports based on untaggedVlanMap
      interfaceList.forEach((ifName) => {
        let isUntagged = false;

        console.log(
          `[ROUTEROS-VLAN] Checking interface ${ifName} for VLAN ${vlanId}...`,
        );

        // Check if this interface has this VLAN as untagged
        if (untaggedVlanMap) {
          for (const [portIndex, untaggedVlanId] of untaggedVlanMap.entries()) {
            if (untaggedVlanId === vlanId) {
              // Find interface by port index using database data
              const interfaceName = getInterfaceNameFromPortIndex(
                portIndex,
                dbInterfaces,
                interfaceNames,
              );

              console.log(
                `[ROUTEROS-VLAN] Port ${portIndex} (${interfaceName}) has untagged VLAN ${untaggedVlanId}, comparing with ${ifName}`,
              );

              if (interfaceName === ifName) {
                isUntagged = true;
                console.log(
                  `[ROUTEROS-VLAN] ✅ Match found: ${ifName} is untagged for VLAN ${vlanId}`,
                );
                break;
              }
            }
          }
        }

        if (isUntagged) {
          untaggedPorts.push(ifName);
          console.log(
            `[ROUTEROS-VLAN] Added ${ifName} to untagged ports for VLAN ${vlanId}`,
          );
        } else {
          taggedPorts.push(ifName);
          console.log(
            `[ROUTEROS-VLAN] Added ${ifName} to tagged ports for VLAN ${vlanId}`,
          );
        }
      });

      vlans.push({
        vlanId,
        name: `VLAN-${vlanId}`,
        description: `VLAN ${vlanId}`,
        taggedPorts: taggedPorts.join(","),
        untaggedPorts: untaggedPorts.join(","),
        tableUsed: "Dynamic SNMP Analysis with Untagged Detection",
      });

      console.log(
        `[ROUTEROS-VLAN] VLAN ${vlanId}: Tagged=[${taggedPorts.join(", ")}], Untagged=[${untaggedPorts.join(", ")}]`,
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
        routerosOids.vlan.mikrotikVlanTable,
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
  dbInterfaces?: any[],
  untaggedVlanMap?: Map<number, number>,
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

        if (vlanId > 0 && vlanId !== 1 && vlanId !== 99 && status === 1) {
          const entryKey = `${vlanId}`;

          if (!vlanEntries.has(entryKey)) {
            vlanEntries.set(entryKey, {
              vlanId,
              taggedPorts: new Set<string>(),
              untaggedPorts: new Set<string>(),
            });
          }

          const vlan = vlanEntries.get(entryKey)!;
          const interfaceName = getInterfaceNameFromPortIndex(
            entryIndex,
            dbInterfaces,
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
