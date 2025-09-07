#!/usr/bin/env node

import * as snmp from "net-snmp";

// Helper function to safely convert SNMP values to string
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

async function testUntaggedVlanParsing() {
  const testDevice = {
    ip: "10.10.99.9", // IP dari contoh SNMP walk
    community: "laros999",
  };

  console.log("=".repeat(80));
  console.log("🔬 TESTING UNTAGGED VLAN PARSING");
  console.log("=".repeat(80));
  console.log(`Target Device: ${testDevice.ip}`);
  console.log(`SNMP Community: ${testDevice.community}`);
  console.log(`Testing OID: 1.3.6.1.2.1.17.7.1.4.5.1.1`);
  console.log("-".repeat(80));

  const session = snmp.createSession(testDevice.ip, testDevice.community, {
    version: snmp.Version2c,
    timeout: 8000,
    retries: 2,
  });

  try {
    console.log("🔍 Step 1: Getting interface names for mapping...");
    const interfaceNames = new Map<number, string>();

    // Get interface names first
    await new Promise<void>((resolve) => {
      session.table("1.3.6.1.2.1.2.2.1", (error: any, tableData: any) => {
        if (error) {
          console.warn("Interface table error:", error.message);
        } else if (tableData) {
          Object.entries(tableData).forEach(
            ([index, columns]: [string, any]) => {
              const ifIndex = parseInt(index);
              const ifName = safeToString(columns["2"]);
              const ifDescr = safeToString(columns["3"]);

              if (ifName) {
                interfaceNames.set(ifIndex, ifName);
              } else if (ifDescr) {
                interfaceNames.set(ifIndex, ifDescr);
              }
            },
          );
        }
        resolve();
      });
    });

    console.log(`✅ Found ${interfaceNames.size} interfaces`);
    interfaceNames.forEach((name, index) => {
      console.log(`   ifIndex ${index} → ${name}`);
    });
    console.log("");

    console.log("🔍 Step 2: Walking untagged VLAN table...");
    const untaggedVlans = new Map<number, number>();

    await new Promise<void>((resolve) => {
      session.walk(
        "1.3.6.1.2.1.17.7.1.4.5.1.1",
        (varbinds: any) => {
          if (varbinds) {
            console.log(`Received ${varbinds.length} varbinds from walk`);

            varbinds.forEach((vb: any) => {
              if (!snmp.isVarbindError(vb)) {
                console.log(
                  `Raw varbind: OID=${vb.oid}, Value=${vb.value}, Type=${typeof vb.value}`,
                );

                // Parse ifIndex and VLAN ID from OID and value
                // Format: 1.3.6.1.2.1.17.7.1.4.5.1.1.<ifIndex> = <vlanId>
                const oidParts = vb.oid.split(".");
                console.log(
                  `OID parts: [${oidParts.join(", ")}] (length: ${oidParts.length})`,
                );

                // Base OID: 1.3.6.1.2.1.17.7.1.4.5.1.1 (12 parts)
                // Only process OIDs that match exactly with our base + 1 additional part
                const baseOid = "1.3.6.1.2.1.17.7.1.4.5.1.1";
                const baseOidParts = baseOid.split(".");

                if (
                  oidParts.length === baseOidParts.length + 1 &&
                  oidParts.slice(0, baseOidParts.length).join(".") === baseOid
                ) {
                  const ifIndex = parseInt(oidParts[baseOidParts.length]);
                  const vlanId = parseInt(vb.value || "0");

                  console.log(
                    `   Parsed: ifIndex=${ifIndex}, vlanId=${vlanId}`,
                  );

                  if (
                    !isNaN(ifIndex) &&
                    !isNaN(vlanId) &&
                    vlanId > 0 &&
                    vlanId !== 1 &&
                    vlanId !== 99
                  ) {
                    untaggedVlans.set(ifIndex, vlanId);
                    const interfaceName =
                      interfaceNames.get(ifIndex) || `if${ifIndex}`;
                    console.log(
                      `   ✅ ifIndex ${ifIndex} (${interfaceName}) is untagged for VLAN ${vlanId}`,
                    );
                  } else if (vlanId === 1 || vlanId === 99) {
                    const interfaceName =
                      interfaceNames.get(ifIndex) || `if${ifIndex}`;
                    console.log(
                      `   ⚠️ Skipping ifIndex ${ifIndex} (${interfaceName}) VLAN ${vlanId} (excluded from sync)`,
                    );
                  } else if (vlanId === 0 || isNaN(vlanId)) {
                    console.log(
                      `   ❌ Invalid VLAN ID ${vlanId} for ifIndex ${ifIndex}`,
                    );
                  }
                } else {
                  console.log(`   ❌ Invalid OID structure: ${vb.oid}`);
                }
              } else {
                console.log(`   ❌ Varbind error: ${vb}`);
              }
            });
          }
        },
        (error: any) => {
          if (error) {
            console.warn(`Untagged VLAN walk error: ${error.message}`);
          }
          console.log(`Found ${untaggedVlans.size} untagged port mappings`);
          resolve();
        },
      );
    });

    console.log("");
    console.log("=".repeat(80));
    console.log("📊 UNTAGGED VLAN PARSING RESULTS");
    console.log("=".repeat(80));

    if (untaggedVlans.size === 0) {
      console.log("❌ No untagged VLANs found");
      console.log("This could indicate:");
      console.log("  - Device has no untagged VLANs configured");
      console.log("  - SNMP community string is incorrect");
      console.log("  - SNMP access is restricted");
      console.log("  - OID path is incorrect");
    } else {
      console.log(`✅ Found ${untaggedVlans.size} untagged VLAN mappings:`);
      console.log("");

      // Sort by ifIndex for easier reading
      const sortedEntries = Array.from(untaggedVlans.entries()).sort(
        ([a], [b]) => a - b,
      );

      sortedEntries.forEach(([ifIndex, vlanId]) => {
        const interfaceName = interfaceNames.get(ifIndex) || `if${ifIndex}`;
        console.log(
          `   ifIndex ${ifIndex} (${interfaceName}) → VLAN ${vlanId} (untagged)`,
        );
      });

      console.log("");
      console.log("🎯 Expected from your SNMP walk example:");
      console.log("   ifIndex 3 → VLAN 303 (untagged)");
      console.log("   ifIndex 9 → VLAN 301 (untagged)");

      // Check if expected results match
      const hasIfIndex3 = untaggedVlans.get(3) === 303;
      const hasIfIndex9 = untaggedVlans.get(9) === 301;

      console.log("");
      console.log("✅ Validation:");
      console.log(
        `   ifIndex 3 → VLAN 303: ${hasIfIndex3 ? "✅ MATCH" : "❌ NO MATCH"}`,
      );
      console.log(
        `   ifIndex 9 → VLAN 301: ${hasIfIndex9 ? "✅ MATCH" : "❌ NO MATCH"}`,
      );

      if (hasIfIndex3 && hasIfIndex9) {
        console.log("");
        console.log("🎉 SUCCESS: Untagged VLAN parsing is working correctly!");
      } else {
        console.log("");
        console.log("⚠️ PARTIAL SUCCESS: Some expected mappings not found");
      }
    }

    session.close();
  } catch (error) {
    console.error("❌ Test failed:", error);
    session.close();
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("🏁 TEST COMPLETED");
  console.log("=".repeat(80));
}

// Run the test
testUntaggedVlanParsing()
  .then(() => {
    console.log("\n✨ Test script finished successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script execution failed:", error);
    process.exit(1);
  });
