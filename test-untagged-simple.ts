#!/usr/bin/env node

import { db } from "./src/db";
import { nodes, interfaces } from "./src/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchMikroTikBridgeVlans } from "./src/services/snmp/index";

async function testUntaggedVlanWithDatabase() {
  console.log("=".repeat(80));
  console.log("🔬 TESTING UNTAGGED VLAN PARSING WITH DATABASE DATA");
  console.log("=".repeat(80));

  try {
    // Find a RouterOS node to test with
    const testNode = await db.query.nodes.findFirst({
      where: and(
        eq(nodes.os, "routeros"),
        eq(nodes.status, true),
        eq(nodes.ipMgmt, "10.10.99.9") // Use the IP from your SNMP walk example
      ),
      with: {
        interfaces: true,
      },
    });

    if (!testNode) {
      console.log("❌ Test node 10.10.99.9 not found in database");
      console.log("Available RouterOS nodes:");

      const allRouterOSNodes = await db.query.nodes.findMany({
        where: and(eq(nodes.os, "routeros"), eq(nodes.status, true)),
      });

      if (allRouterOSNodes.length === 0) {
        console.log("   No active RouterOS nodes found in database");
        return;
      }

      allRouterOSNodes.forEach((node) => {
        console.log(`   - ${node.name} (${node.ipMgmt})`);
      });

      console.log("\nPlease update the IP address in the test script or add the device to database");
      return;
    }

    console.log(`Target Device: ${testNode.name} (${testNode.ipMgmt})`);
    console.log(`SNMP Community: ${testNode.snmpCommunity}`);
    console.log(`Interface count in database: ${testNode.interfaces.length}`);
    console.log("");

    // Show database interface mapping
    console.log("📊 Database Interface Mapping:");
    testNode.interfaces.forEach((iface) => {
      console.log(`   ifIndex ${iface.ifIndex} → ${iface.ifName} (DB ID: ${iface.id})`);
    });
    console.log("");

    console.log("🔍 Testing VLAN fetch with database interface data...");

    const vlanData = await fetchMikroTikBridgeVlans(
      testNode.ipMgmt,
      testNode.snmpCommunity,
      testNode.interfaces
    );

    console.log("");
    console.log("=".repeat(80));
    console.log("📊 VLAN PARSING RESULTS");
    console.log("=".repeat(80));

    if (vlanData.length === 0) {
      console.log("❌ No VLAN data found");
      console.log("This could indicate:");
      console.log("  - Device has no bridge VLANs configured");
      console.log("  - SNMP community string is incorrect");
      console.log("  - Device is unreachable");
      console.log("  - VLAN 1 and 99 were filtered out");
    } else {
      console.log(`✅ Found ${vlanData.length} VLANs:`);
      console.log("");

      vlanData.forEach((vlan, index) => {
        console.log(`VLAN ${index + 1}:`);
        console.log(`  VLAN ID: ${vlan.vlanId}`);
        console.log(`  Name: ${vlan.comment}`);
        console.log(`  Tagged Ports: ${vlan.taggedPorts || "(none)"}`);
        console.log(`  Untagged Ports: ${vlan.untaggedPorts || "(none)"}`);
        console.log("");
      });

      // Check for expected VLANs from your SNMP walk example
      const vlan303 = vlanData.find(v => v.vlanId === 303);
      const vlan301 = vlanData.find(v => v.vlanId === 301);

      console.log("🎯 Expected Results Validation:");
      if (vlan303) {
        console.log(`✅ VLAN 303 found with untagged ports: ${vlan303.untaggedPorts}`);
      } else {
        console.log("❌ VLAN 303 not found (should be untagged on ifIndex 3)");
      }

      if (vlan301) {
        console.log(`✅ VLAN 301 found with untagged ports: ${vlan301.untaggedPorts}`);
      } else {
        console.log("❌ VLAN 301 not found (should be untagged on ifIndex 9)");
      }

      // Check if VLAN 1 and 99 were properly filtered out
      const vlan1 = vlanData.find(v => v.vlanId === 1);
      const vlan99 = vlanData.find(v => v.vlanId === 99);

      console.log("");
      console.log("🚫 Filtering Validation:");
      console.log(`VLAN 1 filtered: ${vlan1 ? "❌ NOT FILTERED" : "✅ FILTERED OUT"}`);
      console.log(`VLAN 99 filtered: ${vlan99 ? "❌ NOT FILTERED" : "✅ FILTERED OUT"}`);

      if (!vlan1 && !vlan99) {
        console.log("✅ VLAN filtering is working correctly!");
      }
    }

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    console.log("");
    console.log("=".repeat(80));
    console.log("🏁 TEST COMPLETED");
    console.log("=".repeat(80));
  }
}

// Run the test
testUntaggedVlanWithDatabase()
  .then(() => {
    console.log("\n✨ Test completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script execution failed:", error);
    process.exit(1);
  });
