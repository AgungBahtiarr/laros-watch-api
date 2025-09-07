import { testMikroTikBridgeVlansSync } from "./src/services/snmp/index";

// Test configuration
const TEST_CONFIG = {
  ipAddress: "10.10.99.11", // Ganti dengan IP MikroTik yang akan ditest
  community: "laros999",    // Ganti dengan SNMP community yang benar
};

async function runTest() {
  console.log("=".repeat(80));
  console.log("🔬 TESTING MIKROTIK BRIDGE VLAN FUNCTIONALITY");
  console.log("=".repeat(80));
  console.log(`Target Device: ${TEST_CONFIG.ipAddress}`);
  console.log(`SNMP Community: ${TEST_CONFIG.community}`);
  console.log("Expected OIDs:");
  console.log("  - Bridge VLAN Table: 1.3.6.1.2.1.17.7.1.2.2.1");
  console.log("  - Untagged VLAN Table: 1.3.6.1.2.1.17.7.1.4.5.1.1");
  console.log("-".repeat(80));

  try {
    const result = await testMikroTikBridgeVlansSync(
      TEST_CONFIG.ipAddress,
      TEST_CONFIG.community
    );

    if (result.success) {
      console.log("✅ TEST PASSED!");
      console.log(`Found ${result.vlanCount} VLANs`);

      if (result.vlans.length > 0) {
        console.log("\n📊 VLAN Details:");
        result.vlans.forEach((vlan: any, index: number) => {
          console.log(`\nVLAN ${index + 1}:`);
          console.log(`  VLAN ID: ${vlan.vlanId}`);
          console.log(`  Tagged Ports: ${vlan.taggedPorts || 'none'}`);
          console.log(`  Untagged Ports: ${vlan.untaggedPorts || 'none'}`);
          console.log(`  Comment: ${vlan.comment || 'none'}`);
        });
      } else {
        console.log("\n⚠️  No VLAN data found. Possible causes:");
        console.log("  - Device has no bridge VLANs configured");
        console.log("  - SNMP community string is incorrect");
        console.log("  - Device is not reachable");
        console.log("  - SNMP is not enabled on the device");
      }
    } else {
      console.log("❌ TEST FAILED!");
      console.log(`Error: ${result.message}`);
    }

  } catch (error) {
    console.log("💥 TEST CRASHED!");
    console.error("Error details:", error);
  }

  console.log("\n" + "=".repeat(80));
  console.log("🏁 TEST COMPLETED");
  console.log("=".repeat(80));
}

// Run the test
runTest().then(() => {
  console.log("\n✨ Test script finished. You can now run:");
  console.log("   bun run test-mikrotik-vlan.ts");
  console.log("\n💡 Tips:");
  console.log("   - Make sure the MikroTik device is reachable");
  console.log("   - Verify SNMP community string is correct");
  console.log("   - Check that SNMP is enabled on the device");
  console.log("   - Ensure bridge VLANs are configured on the device");
}).catch((error) => {
  console.error("Script execution failed:", error);
  process.exit(1);
});
