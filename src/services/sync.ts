import { db } from "../db";
import { fdb, interfaces, nodes, vlanInterfaces } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  fetchSystemUsage,
  getDeviceVendor,
  fetchMikroTikBridgeVlans,
} from "./snmp/index";
import { validateTimeout } from "@/utils/timeout";

// Configuration constants
const DEFAULT_SNMP_TIMEOUT = 8000; // 8 seconds
const MAX_SNMP_TIMEOUT = 30000; // 30 seconds maximum

type LibreNMSCredentials = {
  url: string;
  token: string;
};

export async function syncFdb(creds: LibreNMSCredentials) {
  console.log("Starting FDB sync from LibreNMS...");

  try {
    const response = await fetch(`${creds.url}/resources/fdb`, {
      headers: { "X-Auth-Token": creds.token },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch FDB data from LibreNMS:", errorText);
      throw new HTTPException(response.status as any, {
        message: `Failed to fetch FDB from LibreNMS: ${errorText}`,
      });
    }

    const data = await response.json();
    const fdbFromApi = data.ports_fdb;

    if (!fdbFromApi || fdbFromApi.length === 0) {
      return {
        message: "Sync finished. No FDB entries found in LibreNMS.",
        syncedCount: 0,
      };
    }

    const newValues = fdbFromApi
      .filter((entry: any) => entry.vlan_id !== null)
      .map((entry: any) => ({
        fdbId: entry.ports_fdb_id,
        portId: entry.port_id,
        macAddress: entry.mac_address,
        vlanId: entry.vlan_id,
        deviceId: entry.device_id,
        createdAt: new Date(entry.created_at),
        updatedAt: new Date(entry.updated_at),
      }));

    await db
      .insert(fdb)
      .values(newValues)
      .onConflictDoUpdate({
        target: fdb.fdbId,
        set: {
          portId: sql`excluded.port_id`,
          macAddress: sql`excluded.mac_address`,
          vlanId: sql`excluded.vlan_id`,
          deviceId: sql`excluded.device_id`,
          updatedAt: new Date(),
        },
      });

    console.log("Database FDB sync completed successfully.");

    return {
      message: "FDB sync with LibreNMS completed successfully.",
      syncedCount: newValues.length,
    };
  } catch (error) {
    console.error("An error occurred during the FDB sync process:", error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during FDB sync.",
    });
  }
}

export async function syncNodes(
  creds: LibreNMSCredentials,
  snmpTimeout: number = DEFAULT_SNMP_TIMEOUT,
) {
  const validatedTimeout = validateTimeout(snmpTimeout, 1000, MAX_SNMP_TIMEOUT);
  if (validatedTimeout !== snmpTimeout) {
    console.log(
      `[SYNC] Timeout adjusted from ${snmpTimeout}ms to ${validatedTimeout}ms`,
    );
  }

  console.log(
    `Starting device sync from LibreNMS... (SNMP timeout: ${validatedTimeout}ms)`,
  );

  try {
    const [oldNodesResponse, devicesResponse, locationsResponse] =
      await Promise.all([
        db
          .select({
            ipMgmt: nodes.ipMgmt,
            status: nodes.status,
            name: nodes.name,
          })
          .from(nodes),
        fetch(`${creds.url}/devices`, {
          headers: { "X-Auth-Token": creds.token },
        }),
        fetch(`${creds.url}/resources/locations`, {
          headers: { "X-Auth-Token": creds.token },
        }),
      ]);

    const oldNodesStatusMap = new Map(
      oldNodesResponse.map((node) => [node.ipMgmt, node.status]),
    );

    if (!devicesResponse.ok) {
      const errorText = await devicesResponse.text();
      console.error("Failed to fetch data from LibreNMS:", errorText);
      throw new HTTPException(devicesResponse.status as any, {
        message: `Failed to fetch from LibreNMS: ${errorText}`,
      });
    }

    const devicesData = await devicesResponse.json();
    const devicesFromApi = devicesData.devices;

    if (!devicesFromApi || devicesFromApi.length === 0) {
      return {
        message: "Sync finished. No devices found in LibreNMS.",
        syncedCount: 0,
        changes: [],
      };
    }

    const locationsData = await locationsResponse.json();
    const locationsMap = new Map(
      locationsData.locations.map((location: any) => [
        location.location,
        location,
      ]),
    );

    const filteredDevices = devicesFromApi.filter(
      (device: any) => device.community,
    );

    const deviceProcessingPromises = filteredDevices.map(
      async (device: any) => {
        const location = locationsMap.get(device.location);
        const os = device.os || device.sysDescr || null;
        const vendor = getDeviceVendor(os);

        let cpuUsage = null;
        let ramUsage = null;
        let monitoringStatus: "successful" | "failed" | "skipped" = "skipped";

        if (device.status === 1) {
          try {
            console.log(
              `[MONITORING] Fetching system usage for ${device.sysName || device.hostname} (${device.ip}) - Vendor: ${vendor}`,
            );

            const systemUsage = await fetchSystemUsage(
              device.ip,
              device.community,
              vendor,
            );

            cpuUsage = systemUsage.cpuUsage;
            ramUsage = systemUsage.ramUsage;

            if (cpuUsage !== null || ramUsage !== null) {
              monitoringStatus = "successful";
              console.log(
                `[MONITORING] Successfully fetched usage for ${device.sysName || device.hostname}: CPU=${cpuUsage}%, RAM=${ramUsage}%`,
              );
            } else {
              console.warn(
                `[MONITORING] No usage data retrieved for ${device.sysName || device.hostname} (${device.ip})`,
              );
            }
          } catch (error) {
            monitoringStatus = "failed";
            const isTimeout =
              error instanceof Error && error.message.includes("timeout");
            const errorType = isTimeout ? "TIMEOUT" : "ERROR";
            console.warn(
              `[MONITORING] ❌ ${errorType}: Failed to fetch system usage for ${device.sysName || device.hostname} (${device.ip}): ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        return {
          nodeData: {
            name: device.sysName || device.hostname,
            deviceId: parseInt(device.device_id),
            ipMgmt: device.ip,
            status: device.status === 1,
            snmpCommunity: device.community,
            popLocation: device.location || null,
            lat: location ? (location as any).lat : null,
            lng: location ? (location as any).lng : null,
            os: os,
            cpuUsage: cpuUsage,
            ramUsage: ramUsage,
            updatedAt: new Date(),
          },
          monitoringStatus,
          isUp: device.status === 1,
        };
      },
    );

    const allDeviceResults = await Promise.all(deviceProcessingPromises);

    const newValues = allDeviceResults.map((result) => result.nodeData);

    const monitoringStats = {
      totalDevices: filteredDevices.length,
      upDevices: allDeviceResults.filter((r) => r.isUp).length,
      successfulMonitoring: allDeviceResults.filter(
        (r) => r.monitoringStatus === "successful",
      ).length,
      failedMonitoring: allDeviceResults.filter(
        (r) => r.monitoringStatus === "failed",
      ).length,
      skippedMonitoring: allDeviceResults.filter(
        (r) => r.monitoringStatus === "skipped",
      ).length,
    };

    const successRate =
      monitoringStats.upDevices > 0
        ? (
            (monitoringStats.successfulMonitoring / monitoringStats.upDevices) *
            100
          ).toFixed(1)
        : "0";

    console.log(
      `[MONITORING] System Monitoring Statistics:\n      - Total devices: ${monitoringStats.totalDevices}\n      - Up devices: ${monitoringStats.upDevices}\n      - Successful monitoring: ${monitoringStats.successfulMonitoring} (${successRate}%)\n      - Failed monitoring: ${monitoringStats.failedMonitoring}\n      - Skipped monitoring: ${monitoringStats.skippedMonitoring}`,
    );

    const changedNodes = [];
    for (const newValue of newValues) {
      const oldStatus = oldNodesStatusMap.get(newValue.ipMgmt);
      if (oldStatus !== undefined && oldStatus !== newValue.status) {
        changedNodes.push({
          name: newValue.name,
          ipMgmt: newValue.ipMgmt,
          previous_status: oldStatus ? "UP" : "DOWN",
          current_status: newValue.status ? "UP" : "DOWN",
        });
      }
    }

    if (newValues.length > 0) {
      console.log(
        `[MONITORING] Database sync: Updating ${newValues.length} nodes...`,
      );
      await db
        .insert(nodes)
        .values(newValues)
        .onConflictDoUpdate({
          target: nodes.ipMgmt,
          set: {
            name: sql`excluded.name`,
            deviceId: sql`excluded.devices_id`,
            snmpCommunity: sql`excluded.snmp_community`,
            popLocation: sql`excluded.pop_location`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            status: sql`excluded.status`,
            os: sql`excluded.os`,
            cpuUsage: sql`excluded.cpu_usage`,
            ramUsage: sql`excluded.ram_usage`,
            updatedAt: new Date(),
          },
        });
      console.log("Database node sync completed successfully.");
    } else {
      console.log("No node data to update.");
    }

    return {
      message: "Node sync with LibreNMS completed successfully.",
      syncedCount: newValues.length,
      changes: changedNodes,
    };
  } catch (error) {
    console.error("An error occurred during the node sync process:", error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during node sync.",
    });
  }
}

export async function syncInterfaces(creds: LibreNMSCredentials) {
  console.log("Starting smart interfaces sync from LibreNMS...");

  try {
    const oldInterfaces = await db.query.interfaces.findMany({
      columns: { id: true, ifOperStatus: true, ifName: true },
      with: { node: { columns: { name: true } } },
    });
    const oldInterfaceStatusMap = new Map(
      oldInterfaces.map((iface) => [
        iface.id,
        {
          status: iface.ifOperStatus,
          name: iface.ifName,
          nodeName: iface.node.name,
        },
      ]),
    );

    const allNodesInDb = await db
      .select({
        id: nodes.id,
        deviceId: nodes.deviceId,
        status: nodes.status,
        name: nodes.name,
      })
      .from(nodes);

    if (allNodesInDb.length === 0) {
      return { message: "No nodes found in local DB.", changes: [] };
    }
    console.log(
      `Found ${allNodesInDb.length} nodes. Checking status for each...`,
    );

    let interfacesToUpsert = [];

    const sensorResponse = await fetch(`${creds.url}/resources/sensors`, {
      headers: { "X-Auth-Token": creds.token },
    });

    const sensorMap = new Map();
    if (sensorResponse.ok) {
      const sensorData = await sensorResponse.json();
      const opticalSensors = (sensorData.sensors || []).filter(
        (s: any) =>
          s.entPhysicalIndex_measured === "ports" && s.sensor_class === "dbm",
      );

      for (const sensor of opticalSensors) {
        const ifNameMatch = sensor.sensor_descr.match(/^([^\s]+)/);
        if (ifNameMatch) {
          const ifName = ifNameMatch[1];
          const key = `${sensor.device_id}-${ifName}`;
          if (!sensorMap.has(key)) {
            sensorMap.set(key, {});
          }
          if (
            sensor.sensor_index.includes("OpticalTxPower") ||
            sensor.sensor_index.startsWith("tx-") ||
            sensor.sensor_descr.endsWith(" Tx")
          ) {
            sensorMap.get(key).opticalTx = sensor.sensor_current;
          }
          if (
            sensor.sensor_index.includes("OpticalRxPower") ||
            sensor.sensor_index.startsWith("rx-") ||
            sensor.sensor_index.includes("lane-rx-") ||
            sensor.sensor_descr.endsWith(" Rx")
          ) {
            sensorMap.get(key).opticalRx = sensor.sensor_current;
          }
        }
      }
    }

    for (const node of allNodesInDb) {
      if (node.status === false) {
        await db
          .update(interfaces)
          .set({ ifOperStatus: 2, updatedAt: new Date() })
          .where(eq(interfaces.nodeId, node.id));
      } else {
        const endpoint = `${creds.url}/devices/${node.deviceId}/ports?columns=port_id,ifName,ifDescr,ifAlias,ifOperStatus,ifLastChange,ifIndex,ifType,ifPhysAddress`;
        const response = await fetch(endpoint, {
          headers: { "X-Auth-Token": creds.token },
        });

        if (!response.ok) {
          console.error(
            `Failed to fetch interfaces for UP device ${node.deviceId}: ${response.statusText}`,
          );
          continue;
        }

        const data = await response.json();
        const ports = data.ports || [];

        const mappedPorts = ports
          .map((port: any) => {
            const key = `${node.deviceId}-${port.ifName}`;
            const opticalData = sensorMap.get(key) || {};

            return {
              nodeId: node.id,
              id: port.port_id,
              ifIndex: port.ifIndex,
              ifName: port.ifName,
              ifDescr: port.ifAlias,
              ifType: port.ifType,
              ifPhysAddress: port.ifPhysAddress,
              ifOperStatus: port.ifOperStatus === "up" ? 1 : 2,
              lastChange: port.ifLastChange
                ? new Date(port.ifLastChange * 1000)
                : null,
              opticalTx: opticalData.opticalTx || null,
              opticalRx: opticalData.opticalRx || null,
            };
          })
          .filter(
            (port: any) =>
              port.ifName !== "vlan.mgmt" && !port.ifName.includes("bridge"),
          );
        interfacesToUpsert.push(...mappedPorts);
      }
    }

    if (interfacesToUpsert.length > 0) {
      await db
        .insert(interfaces)
        .values(interfacesToUpsert)
        .onConflictDoUpdate({
          target: [interfaces.nodeId, interfaces.ifIndex],
          set: {
            ifName: sql`excluded.if_name`,
            ifDescr: sql`excluded.if_descr`,
            ifType: sql`excluded.if_type`,
            ifPhysAddress: sql`excluded.if_phys_address`,
            ifOperStatus: sql`excluded.if_oper_status`,
            opticalTx: sql`excluded.optical_tx`,
            opticalRx: sql`excluded.optical_rx`,
            lastChange: sql`excluded.last_change`,
            updatedAt: new Date(),
          },
        });
    }

    const newInterfaces = await db.query.interfaces.findMany({
      columns: { id: true, ifOperStatus: true, ifName: true, ifDescr: true },
      with: { node: { columns: { name: true } } },
    });
    const changedInterfaces = [];

    for (const newIface of newInterfaces) {
      const oldIface = oldInterfaceStatusMap.get(newIface.id);
      if (oldIface && oldIface.status !== newIface.ifOperStatus) {
        changedInterfaces.push({
          name: newIface.ifName,
          description: newIface.ifDescr,
          nodeName: newIface.node.name,
          previous_status: oldIface.status === 1 ? "UP" : "DOWN",
          current_status: newIface.ifOperStatus === 1 ? "UP" : "DOWN",
        });
      }
    }

    console.log("Database interface sync completed successfully.");

    return {
      message: "Smart interface sync completed successfully.",
      changes: changedInterfaces,
    };
  } catch (error) {
    console.error(
      "An error occurred during the interface sync process:",
      error,
    );
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during interface sync.",
    });
  }
}

export async function syncVlans() {
  console.log("Starting VLAN sync for RouterOS devices...");

  try {
    // Get all RouterOS nodes with active status
    const routerOSNodes = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.os, "routeros"), eq(nodes.status, true)));

    if (!routerOSNodes || routerOSNodes.length === 0) {
      return {
        message: "No active RouterOS devices found in the database.",
        syncedCount: 0,
      };
    }

    // Get interfaces for each node separately
    const nodesWithInterfaces = await Promise.all(
      routerOSNodes.map(async (node) => {
        const nodeInterfaces = await db
          .select()
          .from(interfaces)
          .where(eq(interfaces.nodeId, node.id));

        return {
          ...node,
          interfaces: nodeInterfaces,
        };
      }),
    );

    console.log(
      `Found ${nodesWithInterfaces.length} active RouterOS devices to sync VLANs`,
    );

    let totalSyncedCount = 0;
    let successfulDevices = 0;
    let failedDevices = 0;
    const skippedDevices: string[] = [];
    const errorDetails: { [key: string]: string } = {};

    for (const node of nodesWithInterfaces) {
      try {
        console.log(
          `🔄 Fetching VLAN data for ${node.name} (${node.ipMgmt})...`,
        );
        console.log(`   Node has ${node.interfaces.length} interfaces`);
        console.log(`   SNMP Community: ${node.snmpCommunity}`);

        const vlanData = await fetchMikroTikBridgeVlans(
          node.ipMgmt as string,
          node.snmpCommunity as string,
          node.interfaces,
        );

        console.log(
          `   Received ${vlanData.length} VLANs from fetchMikroTikBridgeVlans`,
        );

        if (vlanData.length === 0) {
          console.log(
            `⚠️  No VLAN data found for ${node.name}, device may not have bridge VLANs configured or unreachable`,
          );
          skippedDevices.push(
            `${node.name} (${node.ipMgmt}) - No bridge VLAN data`,
          );
          successfulDevices++; // Count as successful but no data
          continue;
        }

        // Create interface name to ID mapping for this node
        const interfaceMap = new Map(
          node.interfaces.map((iface) => [iface.ifName, iface.id]),
        );

        const vlanEntries: any[] = [];

        for (const vlan of vlanData) {
          const { vlanId, taggedPorts, untaggedPorts, comment } = vlan;

          // Skip VLAN 1 and 99 as they should not be inserted into database
          if (vlanId === 1 || vlanId === 99) {
            console.log(
              `⚠️  Skipping VLAN ${vlanId} for ${node.name} (excluded from sync)`,
            );
            continue;
          }

          // Parse tagged ports (comma separated interface names)
          const taggedInterfaceNames = taggedPorts
            .split(",")
            .map((name: string) => name.trim())
            .filter((name: string) => name.length > 0);

          // Parse untagged ports (comma separated interface names)
          const untaggedInterfaceNames = untaggedPorts
            .split(",")
            .map((name: string) => name.trim())
            .filter((name: string) => name.length > 0);

          // If we have specific port assignments, use them
          if (
            taggedInterfaceNames.length > 0 ||
            untaggedInterfaceNames.length > 0
          ) {
            // Add tagged interfaces
            for (const ifName of taggedInterfaceNames) {
              const interfaceId = interfaceMap.get(ifName);
              if (interfaceId) {
                vlanEntries.push({
                  nodeId: node.id,
                  vlanId: vlanId,
                  interfaceId: interfaceId,
                  isTagged: true,
                  name: comment || `VLAN-${vlanId}`,
                  description: `Tagged VLAN ${vlanId} on ${ifName}`,
                });
              } else {
                console.warn(
                  `Interface ${ifName} not found in database for node ${node.name}`,
                );
              }
            }

            // Add untagged interfaces
            for (const ifName of untaggedInterfaceNames) {
              const interfaceId = interfaceMap.get(ifName);
              if (interfaceId) {
                vlanEntries.push({
                  nodeId: node.id,
                  vlanId: vlanId,
                  interfaceId: interfaceId,
                  isTagged: false,
                  name: comment || `VLAN-${vlanId}`,
                  description: `Untagged VLAN ${vlanId} on ${ifName}`,
                });
              } else {
                console.warn(
                  `Interface ${ifName} not found in database for node ${node.name}`,
                );
              }
            }
          } else {
            // VLAN exists in bridge but no specific port assignment found
            // Add it as tagged on all available interfaces
            for (const iface of node.interfaces) {
              vlanEntries.push({
                nodeId: node.id,
                vlanId: vlanId,
                interfaceId: iface.id,
                isTagged: true,
                name: comment || `VLAN-${vlanId}`,
                description: `VLAN ${vlanId} on ${iface.ifName} (bridge VLAN)`,
              });
            }
          }
        }

        if (vlanEntries.length > 0) {
          await db
            .insert(vlanInterfaces)
            .values(vlanEntries)
            .onConflictDoUpdate({
              target: [
                vlanInterfaces.nodeId,
                vlanInterfaces.vlanId,
                vlanInterfaces.interfaceId,
              ],
              set: {
                isTagged: sql`excluded.is_tagged`,
                name: sql`excluded.name`,
                description: sql`excluded.description`,
                updatedAt: new Date(),
              },
            });

          totalSyncedCount += vlanEntries.length;
          console.log(
            `✅ Synced ${vlanEntries.length} VLAN entries for ${node.name}`,
          );
        }

        successfulDevices++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `❌ Failed to sync VLAN data for ${node.name} (${node.ipMgmt}): ${errorMessage}. Skipping...`,
        );
        failedDevices++;
        errorDetails[`${node.name} (${node.ipMgmt})`] = errorMessage;
        continue;
      }
    }

    console.log(
      `VLAN sync completed. Success: ${successfulDevices}, Failed: ${failedDevices}, Total VLANs synced: ${totalSyncedCount}`,
    );

    return {
      message: "VLAN sync completed.",
      totalNodes: nodesWithInterfaces.length,
      successfulDevices,
      failedDevices,
      syncedCount: totalSyncedCount,
      skippedDevices: skippedDevices.length > 0 ? skippedDevices : undefined,
      errors: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
    };
  } catch (error) {
    console.error("An error occurred during the VLAN sync process:", error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during VLAN sync.",
    });
  }
}
