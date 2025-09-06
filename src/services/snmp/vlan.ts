import * as snmp from "net-snmp";
import { safeToString } from "./utils";
import genericOids from "../../config/generic/oids.json";
import routerosOids from "../../config/routeros/oids.json";

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
        session.table(genericOids.ifTable, (error: any, tableData: any) => {
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
          routerosOids.vlan.mikrotikVlanTable,
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
