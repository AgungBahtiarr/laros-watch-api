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

// Function to fetch Huawei VRP VLAN data using SNMP
export const fetchHuaweiVrpVlans = (
  ipAddress: string,
  community: string,
  dbInterfaces: any[],
): Promise<any[]> => {
  console.log(`[HUAWEI-VRP-VLAN] Fetching VLAN data for ${ipAddress}`);

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
        console.warn(`[HUAWEI-VRP-VLAN] Error closing session: ${closeError}`);
      }
      console.warn(`[HUAWEI-VRP-VLAN] Timeout for ${ipAddress}`);
      resolve([]);
    }, 25000);

    try {
      const vlanData: any[] = [];
      const vlanNames = new Map<number, string>(); // vlanId -> name
      const portVlanMembership = new Map<string, number[]>(); // ifIndex -> [vlanIds]
      const portPvid = new Map<number, number>(); // ifIndex -> pvid (untagged vlan)

      // Create interface mapping from database interfaces
      const interfaceMap = new Map<number, any>();
      if (dbInterfaces && dbInterfaces.length > 0) {
        console.log(`[HUAWEI-VRP-VLAN] Interface mapping from database:`);
        dbInterfaces.forEach((iface) => {
          interfaceMap.set(iface.ifIndex, iface);
          console.log(
            `  ifIndex ${iface.ifIndex} → ${iface.ifName} (id: ${iface.id})`,
          );
        });
      } else {
        console.log(`[HUAWEI-VRP-VLAN] No interface data provided for mapping`);
      }

      console.log(
        `[HUAWEI-VRP-VLAN] Step 1: Getting VLAN names using hwL2VlanName`,
      );

      // Walk VLAN static name table to get VLAN names
      await new Promise<void>((resolveWalk) => {
        try {
          session.subtree(
            "1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.17",
            (varbinds: any[]) => {
              if (varbinds) {
                varbinds.forEach((vb) => {
                  if (!snmp.isVarbindError(vb)) {
                    // Parse VLAN ID from OID
                    // Format: 1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.17.<vlanId>
                    const oidParts = vb.oid.split(".");
                    const baseOid = "1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.17";
                    const baseOidParts = baseOid.split(".");

                    if (
                      oidParts.length === baseOidParts.length + 1 &&
                      oidParts.slice(0, baseOidParts.length).join(".") ===
                        baseOid
                    ) {
                      const vlanId = parseInt(oidParts[baseOidParts.length]);
                      let vlanName = vb.value
                        ? vb.value.toString()
                        : `VLAN${vlanId}`;

                      if (!isNaN(vlanId) && vlanId > 0) {
                        vlanNames.set(vlanId, vlanName);
                        console.log(
                          `[HUAWEI-VRP-VLAN] Found VLAN ${vlanId}: ${vlanName}`,
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
                  `[HUAWEI-VRP-VLAN] VLAN name walk error: ${error.message}`,
                );
              }
              console.log(
                `[HUAWEI-VRP-VLAN] Found ${vlanNames.size} VLANs with names`,
              );
              resolveWalk();
            },
          );
        } catch (walkError) {
          console.warn(
            `[HUAWEI-VRP-VLAN] Failed to start VLAN name walk: ${walkError}`,
          );
          resolveWalk();
        }
      });

      console.log(`[HUAWEI-VRP-VLAN] Step 2: Getting Port VLAN ID (PVID)`);

      // Walk Port VLAN ID table to get untagged VLANs per port
      await new Promise<void>((resolveWalk) => {
        try {
          session.subtree(
            "1.3.6.1.2.1.17.7.1.4.5.1.1",
            (varbinds: any[]) => {
              if (varbinds) {
                varbinds.forEach((vb) => {
                  if (!snmp.isVarbindError(vb)) {
                    // Parse port index from OID - this is NOT ifIndex but bridge port index
                    // We need to map bridge port index to actual ifIndex
                    const oidParts = vb.oid.split(".");
                    const baseOid = "1.3.6.1.2.1.17.7.1.4.5.1.1";
                    const baseOidParts = baseOid.split(".");

                    if (
                      oidParts.length === baseOidParts.length + 1 &&
                      oidParts.slice(0, baseOidParts.length).join(".") ===
                        baseOid
                    ) {
                      const bridgePortIndex = parseInt(
                        oidParts[baseOidParts.length],
                      );
                      const pvid = parseInt(vb.value || "1");

                      if (!isNaN(bridgePortIndex) && !isNaN(pvid) && pvid > 0) {
                        // Map bridge port index to actual ifIndex using same pattern as bitmap
                        let actualIfIndex = null;

                        if (bridgePortIndex >= 1 && bridgePortIndex <= 47) {
                          actualIfIndex = bridgePortIndex + 5;
                        } else if (bridgePortIndex === 0) {
                          actualIfIndex = 65; // Eth-Trunk1
                        } else if (
                          bridgePortIndex >= 48 &&
                          bridgePortIndex <= 55
                        ) {
                          actualIfIndex = bridgePortIndex + 5; // 100GE interfaces
                        }

                        if (actualIfIndex && interfaceMap.has(actualIfIndex)) {
                          portPvid.set(actualIfIndex, pvid);
                          const iface = interfaceMap.get(actualIfIndex);
                          console.log(
                            `[HUAWEI-VRP-VLAN] Bridge port ${bridgePortIndex} → ifIndex ${actualIfIndex} (${
                              iface?.ifName || "unknown"
                            }) PVID: ${pvid}`,
                          );
                        }
                      }
                    }
                  }
                });
              }
            },
            (error: any) => {
              if (error) {
                console.warn(
                  `[HUAWEI-VRP-VLAN] PVID walk error: ${error.message}`,
                );
              }
              console.log(
                `[HUAWEI-VRP-VLAN] Found PVID data for ${portPvid.size} ports`,
              );
              resolveWalk();
            },
          );
        } catch (walkError) {
          console.warn(
            `[HUAWEI-VRP-VLAN] Failed to start PVID walk: ${walkError}`,
          );
          resolveWalk();
        }
      });

      console.log(
        `[HUAWEI-VRP-VLAN] Step 3: Getting VLAN port membership using hwL2VlanPortList`,
      );

      // Walk VLAN port lists using hwL2VlanPortList
      await new Promise<void>((resolveWalk) => {
        try {
          session.subtree(
            "1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.3",
            (varbinds: any[]) => {
              if (varbinds) {
                varbinds.forEach((vb) => {
                  if (!snmp.isVarbindError(vb)) {
                    // Parse VLAN ID from OID
                    // Format: 1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.3.<vlanId>
                    const oidParts = vb.oid.split(".");
                    const baseOid = "1.3.6.1.4.1.2011.5.25.42.3.1.1.1.1.3";
                    const baseOidParts = baseOid.split(".");

                    if (oidParts.length === baseOidParts.length + 1) {
                      const vlanId = parseInt(oidParts[baseOidParts.length]);

                      if (!isNaN(vlanId) && vlanId > 0) {
                        // Parse port bitmap
                        const portBitmap = vb.value;
                        if (portBitmap && Buffer.isBuffer(portBitmap)) {
                          // Convert bitmap to port list by checking each bit
                          for (
                            let byteIndex = 0;
                            byteIndex < portBitmap.length;
                            byteIndex++
                          ) {
                            const byte = portBitmap[byteIndex];
                            for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
                              if (byte & (1 << (7 - bitIndex))) {
                                const bitPosition = byteIndex * 8 + bitIndex;

                                // Huawei VRP bit mapping berdasarkan analisis hex lengkap:
                                // Pattern: bit position + 5 = ifIndex untuk sebagian besar 25GE
                                // Verified mappings:
                                // bit 1 → ifIndex 6 (25GE1/0/2)
                                // bit 8 → ifIndex 13 (25GE1/0/9)
                                // bit 9 → ifIndex 14 (25GE1/0/10)
                                // bit 14 → ifIndex 19 (25GE1/0/15)
                                // bit 15 → ifIndex 20 (25GE1/0/16)
                                // bit 19 → ifIndex 24 (25GE1/0/20)
                                // bit 26 → ifIndex 31 (25GE1/0/27)
                                // bit 28 → ifIndex 33 (25GE1/0/29)
                                // bit 32 → ifIndex 37 (25GE1/0/33)
                                // bit 47 → ifIndex 52 (25GE1/0/48)
                                // bit 48 → ifIndex 53 (100GE1/0/1)
                                // bit 49 → ifIndex 54 (100GE1/0/2)

                                let actualIfIndex = null;

                                // Main pattern: bit position + 5 = ifIndex
                                if (bitPosition >= 1 && bitPosition <= 47) {
                                  const candidateIndex = bitPosition + 5;
                                  if (interfaceMap.has(candidateIndex)) {
                                    actualIfIndex = candidateIndex;
                                  }
                                }

                                // Special cases
                                if (!actualIfIndex) {
                                  const specialMappings = new Map([
                                    [0, 65], // Eth-Trunk1
                                    [48, 53], // 100GE1/0/1
                                    [49, 54], // 100GE1/0/2
                                    [50, 55], // 100GE1/0/3
                                    [51, 56], // 100GE1/0/4
                                    [52, 57], // 100GE1/0/5
                                    [53, 58], // 100GE1/0/6
                                    [54, 59], // 100GE1/0/7
                                    [55, 60], // 100GE1/0/8
                                  ]);
                                  actualIfIndex =
                                    specialMappings.get(bitPosition);
                                }

                                if (
                                  actualIfIndex &&
                                  interfaceMap.has(actualIfIndex)
                                ) {
                                  // Port is member of this VLAN
                                  const key = `${actualIfIndex}`;
                                  if (!portVlanMembership.has(key)) {
                                    portVlanMembership.set(key, []);
                                  }
                                  portVlanMembership.get(key)!.push(vlanId);

                                  const iface = interfaceMap.get(actualIfIndex);
                                  console.log(
                                    `[HUAWEI-VRP-VLAN] Bit ${bitPosition} → ifIndex ${actualIfIndex} (${
                                      iface?.ifName || "unknown"
                                    }) is member of VLAN ${vlanId}`,
                                  );
                                } else {
                                  console.log(
                                    `[HUAWEI-VRP-VLAN] Bit ${bitPosition} set but no matching ifIndex found for VLAN ${vlanId}`,
                                  );
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                });
              }
            },
            (error: any) => {
              if (error) {
                console.warn(
                  `[HUAWEI-VRP-VLAN] Port membership walk error: ${error.message}`,
                );
              }
              console.log(
                `[HUAWEI-VRP-VLAN] Found port membership data for ${portVlanMembership.size} ports`,
              );
              resolveWalk();
            },
          );
        } catch (walkError) {
          console.warn(
            `[HUAWEI-VRP-VLAN] Failed to start port membership walk: ${walkError}`,
          );
          resolveWalk();
        }
      });

      console.log(
        `[HUAWEI-VRP-VLAN] Step 4: Processing VLAN data and port mappings`,
      );

      // Build VLAN data structure
      const allVlanIds = new Set<number>();

      // Add VLANs from names
      vlanNames.forEach((name, vlanId) => {
        if (vlanId !== 1) {
          // Skip default VLAN 1
          allVlanIds.add(vlanId);
        }
      });

      // Add VLANs from port memberships
      portVlanMembership.forEach((vlanIds) => {
        vlanIds.forEach((vlanId) => {
          if (vlanId !== 1) {
            // Skip default VLAN 1
            allVlanIds.add(vlanId);
          }
        });
      });

      console.log(
        `[HUAWEI-VRP-VLAN] Processing ${allVlanIds.size} total VLANs (excluding VLAN 1): ${Array.from(
          allVlanIds,
        )
          .sort((a, b) => a - b)
          .join(", ")}`,
      );

      allVlanIds.forEach((vlanId) => {
        const vlanName = vlanNames.get(vlanId) || `VLAN${vlanId}`;
        const taggedPorts: string[] = [];
        const untaggedPorts: string[] = [];

        // Check each port to see if it's a member of this VLAN
        portVlanMembership.forEach((vlanIds, portKey) => {
          const portIndex = parseInt(portKey);
          if (vlanIds.includes(vlanId)) {
            const iface = interfaceMap.get(portIndex);
            if (iface && iface.ifName) {
              const pvid = portPvid.get(portIndex) || 1;

              // Determine if port is tagged or untagged
              if (pvid === vlanId) {
                // This port is untagged for this VLAN
                untaggedPorts.push(iface.ifName);
              } else {
                // Port is member but not untagged, so it's tagged
                taggedPorts.push(iface.ifName);
              }
            }
          }
        });

        // Sort ports for consistent output
        taggedPorts.sort();
        untaggedPorts.sort();

        console.log(
          `[HUAWEI-VRP-VLAN] VLAN ${vlanId} (${vlanName}): Tagged=[${taggedPorts.join(",")}], Untagged=[${untaggedPorts.join(",")}]`,
        );

        if (taggedPorts.length > 0 || untaggedPorts.length > 0) {
          vlanData.push({
            vlanId: vlanId,
            taggedPorts: taggedPorts.join(","),
            untaggedPorts: untaggedPorts.join(","),
            comment: vlanName,
          });
        }
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
        `[HUAWEI-VRP-VLAN] Successfully fetched ${vlanData.length} VLANs for ${ipAddress}`,
      );

      // Summary for verification
      console.log(`[HUAWEI-VRP-VLAN] Summary for ${ipAddress}:`);
      console.log(`  Total VLANs: ${vlanNames.size}`);
      console.log(`  VLANs with ports: ${vlanData.length}`);
      console.log(`  Total interfaces: ${interfaceMap.size}`);
      console.log(`  Ports with PVID: ${portPvid.size}`);
      console.log(`  Port-VLAN memberships: ${portVlanMembership.size}`);

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
        `[HUAWEI-VRP-VLAN] Error fetching VLAN data for ${ipAddress}: ${errorMessage}`,
      );
      reject(error);
    }
  });
};
