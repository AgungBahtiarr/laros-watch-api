#!/usr/bin/env node

import { fetchRouterOSVlans, testSNMPConnectivity } from "./dist/snmp.js";

async function testVlanFunctionality() {
  const testDevice = {
    ip: "10.10.99.24",
    community: "public", // Adjust if needed
  };

  console.log("=".repeat(60));
  console.log("VLAN FUNCTIONALITY TEST");
  console.log("=".repeat(60));
  console.log(`Testing device: ${testDevice.ip}`);
  console.log("");

  try {
    // Test 1: Basic SNMP connectivity
    console.log("Test 1: Testing SNMP connectivity...");
    const connectivityTest = await testSNMPConnectivity(
      testDevice.ip,
      testDevice.community,
    );

    if (!connectivityTest.connectivity) {
      console.error("❌ SNMP connectivity failed:", connectivityTest.error);
      return;
    }

    console.log("✅ SNMP connectivity successful");
    console.log(
      "   Supported versions:",
      connectivityTest.supportedVersions.join(", "),
    );
    console.log(
      "   System info:",
      connectivityTest.systemInfo?.sysDescr?.substring(0, 100) + "...",
    );
    console.log("");

    // Test 2: Fetch VLAN data
    console.log("Test 2: Fetching VLAN data...");
    const vlanData = await fetchRouterOSVlans(
      testDevice.ip,
      testDevice.community,
    );

    console.log(`✅ VLAN fetch completed. Found ${vlanData.length} VLANs`);
    console.log("");

    if (vlanData.length === 0) {
      console.log("⚠️  No VLAN data found. This could mean:");
      console.log("   - Device has no VLANs configured");
      console.log("   - SNMP community string is incorrect");
      console.log("   - SNMP access is restricted");
      console.log("   - Device does not support standard VLAN MIBs");
      return;
    }

    // Test 3: Display VLAN information
    console.log("Test 3: VLAN Details");
    console.log("-".repeat(80));

    const expectedVlans = [
      99, 108, 117, 2, 203, 204, 207, 209, 210, 208, 4000, 1765, 1766, 1767, 1,
    ];
    const foundVlanIds = vlanData.map((v) => v.vlanId).sort((a, b) => a - b);

    console.log(
      "Expected VLANs (from your device output):",
      expectedVlans.join(", "),
    );
    console.log("Found VLANs:", foundVlanIds.join(", "));
    console.log("");

    vlanData.forEach((vlan, index) => {
      console.log(`VLAN ${index + 1}:`);
      console.log(`  ID: ${vlan.vlanId}`);
      console.log(`  Name: ${vlan.name}`);
      console.log(`  Description: ${vlan.description}`);
      console.log(`  Tagged Ports: ${vlan.taggedPorts || "(none)"}`);
      console.log(`  Untagged Ports: ${vlan.untaggedPorts || "(none)"}`);
      console.log(`  Table Used: ${vlan.tableUsed}`);
      console.log("");
    });

    // Test 4: Comparison with expected data
    console.log("Test 4: Comparison with expected MikroTik output");
    console.log("-".repeat(80));

    const expectedVlanData = {
      99: { tagged: ["bridge1", "sfp-sfpplus2"], untagged: [] },
      108: {
        tagged: ["sfp-sfpplus1", "sfp-sfpplus2"],
        untagged: ["sfp-sfpplus4"],
      },
      117: {
        tagged: ["sfp-sfpplus1", "sfp-sfpplus2"],
        untagged: ["sfp-sfpplus3"],
      },
      2: { tagged: ["sfp-sfpplus2", "ether1"], untagged: [] }, // disabled
      1: { tagged: [], untagged: ["bridge1", "sfp-sfpplus1"] }, // dynamic
    };

    // Check multi-VLAN entry: 203,204,207,209,210,208,4000
    const multiVlanIds = [203, 204, 207, 209, 210, 208, 4000];
    const multiVlanExpected = {
      tagged: ["sfp-sfpplus1", "sfp-sfpplus2"],
      untagged: [],
    };

    // Check triple VLAN entry: 1765,1766,1767
    const tripleVlanIds = [1765, 1766, 1767];
    const tripleVlanExpected = {
      tagged: ["sfp-sfpplus2", "sfp-sfpplus1"],
      untagged: [],
    };

    let matchCount = 0;
    let totalExpected =
      Object.keys(expectedVlanData).length +
      multiVlanIds.length +
      tripleVlanIds.length;

    // Check individual VLANs
    Object.entries(expectedVlanData).forEach(([vlanId, expected]) => {
      const found = vlanData.find((v) => v.vlanId === parseInt(vlanId));
      if (found) {
        const foundTagged = found.taggedPorts
          ? found.taggedPorts.split(",").map((p) => p.trim())
          : [];
        const foundUntagged = found.untaggedPorts
          ? found.untaggedPorts.split(",").map((p) => p.trim())
          : [];

        const taggedMatch = expected.tagged.some((port) =>
          foundTagged.includes(port),
        );
        const untaggedMatch =
          expected.untagged.length === 0
            ? foundUntagged.length === 0
            : expected.untagged.some((port) => foundUntagged.includes(port));

        if (taggedMatch || untaggedMatch) {
          console.log(`✅ VLAN ${vlanId}: Found with matching ports`);
          matchCount++;
        } else {
          console.log(
            `⚠️  VLAN ${vlanId}: Found but ports don't match exactly`,
          );
          console.log(`    Expected tagged: [${expected.tagged.join(", ")}]`);
          console.log(`    Found tagged: [${foundTagged.join(", ")}]`);
          console.log(
            `    Expected untagged: [${expected.untagged.join(", ")}]`,
          );
          console.log(`    Found untagged: [${foundUntagged.join(", ")}]`);
        }
      } else {
        console.log(`❌ VLAN ${vlanId}: Not found`);
      }
    });

    // Check multi-VLAN entries
    multiVlanIds.forEach((vlanId) => {
      const found = vlanData.find((v) => v.vlanId === vlanId);
      if (found) {
        console.log(`✅ Multi-VLAN ${vlanId}: Found`);
        matchCount++;
      } else {
        console.log(`❌ Multi-VLAN ${vlanId}: Not found`);
      }
    });

    tripleVlanIds.forEach((vlanId) => {
      const found = vlanData.find((v) => v.vlanId === vlanId);
      if (found) {
        console.log(`✅ Triple-VLAN ${vlanId}: Found`);
        matchCount++;
      } else {
        console.log(`❌ Triple-VLAN ${vlanId}: Not found`);
      }
    });

    console.log("");
    console.log("=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total VLANs found: ${vlanData.length}`);
    console.log(`Expected VLANs: ${totalExpected}`);
    console.log(`Matching VLANs: ${matchCount}`);
    console.log(
      `Success rate: ${Math.round((matchCount / totalExpected) * 100)}%`,
    );

    if (matchCount === totalExpected) {
      console.log(
        "🎉 All expected VLANs found! VLAN functionality is working perfectly.",
      );
    } else if (matchCount > totalExpected / 2) {
      console.log("✅ Most VLANs found. VLAN functionality is working well.");
    } else {
      console.log(
        "⚠️  Some VLANs missing. VLAN functionality needs improvement.",
      );
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("Full error:", error);
  }
}

// Run the test
testVlanFunctionality().catch(console.error);
