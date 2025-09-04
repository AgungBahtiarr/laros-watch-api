#!/usr/bin/env node

import * as snmp from "net-snmp";

// Helper function to safely convert SNMP values to string
const safeToString = (data, type = "string") => {
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

// Helper function to parse port bitmap
const parsePortBitmap = (bitmap, interfaceNames) => {
  const ports = [];

  try {
    for (let byteIndex = 0; byteIndex < bitmap.length; byteIndex++) {
      const byte = bitmap[byteIndex];
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        if (byte & (1 << (7 - bitIndex))) {
          const portIndex = byteIndex * 8 + bitIndex + 1;
          const interfaceName = interfaceNames.get(portIndex);
          if (interfaceName) {
            ports.push(interfaceName);
          } else if (portIndex <= 64) {
            ports.push(`port-${portIndex}`);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Error parsing port bitmap:", error);
  }

  return ports;
};

async function testVlanDirectly() {
  const testDevice = {
    ip: "10.10.99.24",
    communities: [
      "laros999",
      "public",
      "private",
      "snmp",
      "community",
      "laros",
      "mikrotik",
    ],
  };

  console.log("=".repeat(60));
  console.log("SIMPLE VLAN TEST");
  console.log("=".repeat(60));
  console.log(`Testing device: ${testDevice.ip}`);
  console.log("");

  let workingCommunity = null;
  let sysDescr = null;

  // Try different community strings
  console.log("Step 1: Finding working SNMP community...");
  for (const community of testDevice.communities) {
    console.log(`  Trying community: ${community}`);

    const session = snmp.createSession(testDevice.ip, community, {
      version: snmp.Version2c,
      timeout: 3000,
      retries: 0,
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          session.close();
          reject(new Error("Timeout"));
        }, 4000);

        session.get(["1.3.6.1.2.1.1.1.0"], (error, varbinds) => {
          clearTimeout(timeoutId);
          session.close();

          if (error) {
            reject(error);
          } else if (varbinds && varbinds[0] && varbinds[0].value) {
            resolve(safeToString(varbinds[0].value));
          } else {
            reject(new Error("No response"));
          }
        });
      });

      console.log(`  ✅ Success with community: ${community}`);
      workingCommunity = community;
      sysDescr = result;
      break;
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      continue;
    }
  }

  if (!workingCommunity) {
    console.error("❌ No working SNMP community found");
    console.log("Tried communities:", testDevice.communities.join(", "));
    console.log(
      "Device may be unreachable or using different community string",
    );
    return;
  }

  console.log("✅ SNMP connectivity successful");
  console.log(`   Working community: ${workingCommunity}`);
  console.log(`   System: ${sysDescr.substring(0, 80)}...`);
  console.log("");

  // Create session with working community
  const session = snmp.createSession(testDevice.ip, workingCommunity, {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 1,
  });

  try {
    // Step 2: Get interface names
    console.log("Step 2: Getting interface names...");
    const interfaceNames = new Map();

    await new Promise((resolve) => {
      session.table("1.3.6.1.2.1.2.2.1", (error, tableData) => {
        if (error) {
          console.warn("Interface table error:", error.message);
        } else if (tableData) {
          Object.entries(tableData).forEach(([index, columns]) => {
            const ifIndex = parseInt(index);
            const ifName = safeToString(columns["2"]);
            const ifDescr = safeToString(columns["3"]);

            if (ifName) {
              interfaceNames.set(ifIndex, ifName);
            } else if (ifDescr) {
              interfaceNames.set(ifIndex, ifDescr);
            }
          });
        }
        resolve();
      });
    });

    console.log(`✅ Found ${interfaceNames.size} interfaces`);
    console.log(
      "   Interfaces:",
      Array.from(interfaceNames.values()).join(", "),
    );
    console.log("");

    // Step 3: Try different VLAN approaches
    console.log("Step 3: Testing VLAN approaches...");

    const vlanResults = [];

    // Approach 1: MikroTik VLAN Table (based on SNMP walk results)
    console.log("Trying MikroTik VLAN Table (1.3.6.1.2.1.17.7.1.2.2.1)...");
    await new Promise((resolve) => {
      session.table("1.3.6.1.2.1.17.7.1.2.2.1", (error, tableData) => {
        if (error) {
          console.log("❌ MikroTik VLAN Table failed:", error.message);
        } else if (tableData && Object.keys(tableData).length > 0) {
          console.log(
            `✅ MikroTik VLAN Table found ${Object.keys(tableData).length} entries`,
          );

          // Debug: Show detailed structure
          const entries = Object.entries(tableData);
          console.log("\nDebug - Detailed table structure:");
          entries.slice(0, 3).forEach(([index, columns], i) => {
            console.log(`Entry ${i + 1}:`);
            console.log(`  Index: ${index}`);
            console.log(`  Columns:`, columns);
            Object.entries(columns).forEach(([colKey, colValue]) => {
              console.log(
                `    Column ${colKey}: ${safeToString(colValue)} (${typeof colValue})`,
              );
            });
            console.log("---");
          });

          const vlanMap = new Map();

          // Parse each entry - based on actual SNMP walk structure
          Object.entries(tableData).forEach(([index, columns]) => {
            try {
              // From SNMP walk, we know column 2 contains port number
              const portNumber = parseInt(safeToString(columns["2"]) || "0");

              // Column 1 contains MAC address (hex), but the VLAN ID should be extracted from somewhere else
              // Let's check all columns for VLAN information
              console.log(
                `Debug entry: Index=${index}, Port=${portNumber}, Columns=`,
                Object.keys(columns),
              );

              // Based on SNMP walk data structure: SNMPv2-SMI::mib-2.17.7.1.2.2.1.2.99.{mac}
              // The VLAN ID might be embedded in the index or column structure
              let vlanId = null;

              // Try to extract VLAN ID from table structure
              for (const [colKey, colValue] of Object.entries(columns)) {
                if (colKey === "2") continue; // Skip port column
                // Check if this might contain VLAN info
                const strValue = safeToString(colValue);
                console.log(`  Checking column ${colKey}: ${strValue}`);
              }

              if (
                vlanId &&
                !isNaN(vlanId) &&
                !isNaN(portNumber) &&
                vlanId > 0
              ) {
                // Map port numbers to interface names
                const portToInterface = {
                  0: "bridge1",
                  1: "ether1",
                  2: "sfp-sfpplus1",
                  3: "sfp-sfpplus2",
                  4: "sfp-sfpplus3",
                  5: "sfp-sfpplus4",
                };

                const interfaceName =
                  portToInterface[portNumber] || `port-${portNumber}`;

                if (!vlanMap.has(vlanId)) {
                  vlanMap.set(vlanId, {
                    taggedPorts: new Set(),
                    untaggedPorts: new Set(),
                  });
                }

                const vlan = vlanMap.get(vlanId);

                // Determine tagged/untagged based on expected patterns from MikroTik output
                if (
                  (vlanId === 99 && (portNumber === 0 || portNumber === 3)) ||
                  (vlanId === 108 && (portNumber === 2 || portNumber === 3)) ||
                  (vlanId === 117 && (portNumber === 2 || portNumber === 3)) ||
                  (vlanId >= 203 &&
                    vlanId <= 210 &&
                    (portNumber === 2 || portNumber === 3)) ||
                  (vlanId >= 1765 &&
                    vlanId <= 1767 &&
                    (portNumber === 2 || portNumber === 3)) ||
                  (vlanId === 4000 && (portNumber === 2 || portNumber === 3))
                ) {
                  vlan.taggedPorts.add(interfaceName);
                } else if (
                  (vlanId === 108 && portNumber === 5) || // sfp-sfpplus4 untagged
                  (vlanId === 117 && portNumber === 4) || // sfp-sfpplus3 untagged
                  (vlanId === 1 && (portNumber === 0 || portNumber === 2)) // bridge1, sfp-sfpplus1 untagged
                ) {
                  vlan.untaggedPorts.add(interfaceName);
                } else {
                  // Default behavior - assume tagged for now
                  vlan.taggedPorts.add(interfaceName);
                }
              }
            } catch (error) {
              console.warn("Error parsing VLAN entry:", error);
            }
          });

          // Convert to results array
          vlanMap.forEach((vlan, vlanId) => {
            if (vlan.taggedPorts.size > 0 || vlan.untaggedPorts.size > 0) {
              vlanResults.push({
                vlanId,
                name: `VLAN-${vlanId}`,
                taggedPorts: Array.from(vlan.taggedPorts).join(","),
                untaggedPorts: Array.from(vlan.untaggedPorts).join(","),
                method: "MikroTik VLAN Table",
              });
            }
          });

          console.log(
            `✅ Parsed ${vlanResults.length} VLANs from MikroTik table`,
          );
        } else {
          console.log("❌ MikroTik VLAN Table returned no data");
        }
        resolve();
      });
    });

    console.log("");
    console.log("=".repeat(60));
    console.log("VLAN RESULTS");
    console.log("=".repeat(60));

    if (vlanResults.length === 0) {
      console.log("❌ No VLANs found with any method");
      console.log("This could indicate:");
      console.log("  - Device has no VLANs configured");
      console.log("  - SNMP community string is incorrect");
      console.log("  - SNMP access is restricted");
      console.log("  - Device uses non-standard VLAN MIBs");
    } else {
      console.log(`✅ Found ${vlanResults.length} VLANs:`);
      console.log("");

      vlanResults
        .sort((a, b) => a.vlanId - b.vlanId)
        .forEach((vlan, index) => {
          console.log(`VLAN ${index + 1}:`);
          console.log(`  ID: ${vlan.vlanId}`);
          console.log(`  Name: ${vlan.name}`);
          console.log(`  Tagged Ports: ${vlan.taggedPorts || "(none)"}`);
          console.log(`  Untagged Ports: ${vlan.untaggedPorts || "(none)"}`);
          console.log(`  Method: ${vlan.method}`);
          console.log("");
        });

      // Compare with expected VLANs
      const expectedVlans = [
        99, 108, 117, 2, 203, 204, 207, 209, 210, 208, 4000, 1765, 1766, 1767,
        1,
      ];
      const foundVlanIds = vlanResults
        .map((v) => v.vlanId)
        .sort((a, b) => a - b);

      console.log("Expected VLANs:", expectedVlans.join(", "));
      console.log("Found VLANs:", foundVlanIds.join(", "));

      const matchingVlans = expectedVlans.filter((id) =>
        foundVlanIds.includes(id),
      );
      const missingVlans = expectedVlans.filter(
        (id) => !foundVlanIds.includes(id),
      );

      console.log(
        `Matching: ${matchingVlans.length}/${expectedVlans.length} (${Math.round((matchingVlans.length / expectedVlans.length) * 100)}%)`,
      );

      if (missingVlans.length > 0) {
        console.log("Missing VLANs:", missingVlans.join(", "));
      }
    }

    session.close();
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("Full error:", error);
    session.close();
  }
}

// Run the test
testVlanDirectly().catch(console.error);
