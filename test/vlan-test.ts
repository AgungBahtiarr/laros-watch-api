import { db } from "../src/db";
import { fetchRouterOSVlans } from "../src/services/snmp/vlan";
import { eq, and } from "drizzle-orm";
import { nodes } from "../src/db/schema";

async function testVlanSync() {
  console.log("🔍 Starting direct VLAN test for node 14...");

  try {
    // Get node 14 data from database
    const node = await db.query.nodes.findFirst({
      where: and(
        eq(nodes.id, 14),
        eq(nodes.os, "routeros"),
        eq(nodes.status, true),
      ),
      with: {
        interfaces: true,
      },
    });

    if (!node) {
      console.error("❌ Node 14 not found or not a RouterOS device");
      return;
    }

    console.log(`📋 Node Info:`);
    console.log(`   ID: ${node.id}`);
    console.log(`   Name: ${node.name}`);
    console.log(`   IP: ${node.ipMgmt}`);
    console.log(`   Community: ${node.snmpCommunity}`);
    console.log(`   Interfaces: ${node.interfaces.length}`);

    // Log interface details
    console.log(`\n🔌 Interfaces in database:`);
    node.interfaces.forEach((iface) => {
      console.log(`   ifIndex: ${iface.ifIndex}, ifName: ${iface.ifName}`);
    });

    console.log(`\n📋 Debug: Let's check interface mapping first...`);

    // Debug interface mapping - check what port index corresponds to what interface
    console.log(`\n🔍 Interface Debug Info:`);
    console.log(`Expected mapping based on Mikrotik CLI:`);
    console.log(
      `   VLAN 117: untagged=sfp-sfpplus3, tagged=sfp-sfpplus1,sfp-sfpplus2`,
    );
    console.log(
      `   VLAN 108: untagged=sfp-sfpplus4, tagged=sfp-sfpplus1,sfp-sfpplus2`,
    );

    console.log(`\nFrom SNMP untagged data we got:`);
    console.log(
      `   Port 3 -> VLAN 117 (maps to ${node.interfaces.find((i) => i.ifIndex === 3)?.ifName || "unknown"})`,
    );
    console.log(
      `   Port 4 -> VLAN 108 (maps to ${node.interfaces.find((i) => i.ifIndex === 4)?.ifName || "unknown"})`,
    );

    console.log(`\nThis suggests:`);
    console.log(
      `   Port 3 should map to sfp-sfpplus3 (but we have ${node.interfaces.find((i) => i.ifIndex === 3)?.ifName})`,
    );
    console.log(
      `   Port 4 should map to sfp-sfpplus4 (but we have ${node.interfaces.find((i) => i.ifIndex === 4)?.ifName})`,
    );

    // Check if there's an off-by-one or different mapping
    console.log(`\nChecking alternative mappings:`);
    for (let i = 1; i <= 6; i++) {
      const iface = node.interfaces.find((intf) => intf.ifIndex === i);
      if (iface) {
        console.log(`   ifIndex ${i} -> ${iface.ifName}`);
      }
    }

    console.log(`\n🔄 Now fetching VLAN data...`);

    // Test VLAN fetch
    const vlanData = await fetchRouterOSVlans(
      node.ipMgmt,
      node.snmpCommunity,
      node.interfaces,
    );

    console.log(`\n📊 Results:`);
    console.log(`   Total VLANs found: ${vlanData.length}`);

    if (vlanData.length === 0) {
      console.warn("⚠️  No VLAN data found!");
      return;
    }

    // Display VLAN results
    vlanData.forEach((vlan, index) => {
      console.log(`\n   VLAN ${index + 1}:`);
      console.log(`     VLAN ID: ${vlan.vlanId}`);
      console.log(`     Name: ${vlan.name}`);
      console.log(`     Tagged Ports: [${vlan.taggedPorts}]`);
      console.log(`     Untagged Ports: [${vlan.untaggedPorts}]`);
      console.log(`     Table Used: ${vlan.tableUsed}`);

      // Validate against expected data
      if (vlan.vlanId === 117) {
        console.log(`     ✅ Expected: sfp-sfpplus3 should be untagged`);
        console.log(
          `     ✅ Expected: sfp-sfpplus1,sfp-sfpplus2 should be tagged`,
        );
        const correctUntagged = vlan.untaggedPorts.includes("sfp-sfpplus3");
        const correctTagged =
          vlan.taggedPorts.includes("sfp-sfpplus1") &&
          vlan.taggedPorts.includes("sfp-sfpplus2");
        console.log(
          `     ${correctUntagged ? "✅" : "❌"} Untagged correct: ${correctUntagged}`,
        );
        console.log(
          `     ${correctTagged ? "✅" : "❌"} Tagged correct: ${correctTagged}`,
        );
      }
      if (vlan.vlanId === 108) {
        console.log(`     ✅ Expected: sfp-sfpplus4 should be untagged`);
        console.log(
          `     ✅ Expected: sfp-sfpplus1,sfp-sfpplus2 should be tagged`,
        );
        const correctUntagged = vlan.untaggedPorts.includes("sfp-sfpplus4");
        const correctTagged =
          vlan.taggedPorts.includes("sfp-sfpplus1") &&
          vlan.taggedPorts.includes("sfp-sfpplus2");
        console.log(
          `     ${correctUntagged ? "✅" : "❌"} Untagged correct: ${correctUntagged}`,
        );
        console.log(
          `     ${correctTagged ? "✅" : "❌"} Tagged correct: ${correctTagged}`,
        );
      }
    });

    console.log(`\n✅ Test completed successfully!`);
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testVlanSync();
