import * as snmp from "net-snmp";

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
