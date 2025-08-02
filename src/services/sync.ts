import { db } from "@/db";
import { fdb, interfaces, nodes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

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
      throw new HTTPException(response.status, {
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
          updatedAt: sql`excluded.updated_at`,
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

export async function syncNodes(creds: LibreNMSCredentials) {
  console.log("Starting device sync from LibreNMS...");

  try {
    const oldNodes = await db
      .select({ ipMgmt: nodes.ipMgmt, status: nodes.status, name: nodes.name })
      .from(nodes);
    const oldNodesStatusMap = new Map(
      oldNodes.map((node) => [node.ipMgmt, node.status]),
    );

    const response = await fetch(`${creds.url}/devices`, {
      headers: { "X-Auth-Token": creds.token },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch data from LibreNMS:", errorText);
      throw new HTTPException(response.status, {
        message: `Failed to fetch from LibreNMS: ${errorText}`,
      });
    }

    const data = await response.json();
    const devicesFromApi = data.devices;

    if (!devicesFromApi || devicesFromApi.length === 0) {
      return {
        message: "Sync finished. No devices found in LibreNMS.",
        syncedCount: 0,
        changes: [],
      };
    }

    const locationsResponse = await fetch(`${creds.url}/resources/locations`, {
      headers: { "X-Auth-Token": creds.token },
    });
    const locationsData = await locationsResponse.json();
    const locationsMap = new Map(
      locationsData.locations.map((location: any) => [
        location.location,
        location,
      ]),
    );

    const newValues = devicesFromApi
      .filter((device: any) => device.community)
      .map((device: any) => {
        const location = locationsMap.get(device.location);
        return {
          name: device.sysName || device.hostname,
          deviceId: parseInt(device.device_id),
          ipMgmt: device.ip,
          status: device.status,
          snmpCommunity: device.community,
          popLocation: device.location || null,
          lat: location ? location.lat : null,
          lng: location ? location.lng : null,
          updatedAt: new Date(),
        };
      });

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
          updatedAt: new Date(),
        },
      });

    console.log("Database node sync completed successfully.");

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
      if (node.status === false || node.status === 0) {
        await db
          .update(interfaces)
          .set({ ifOperStatus: 2, updatedAt: new Date() })
          .where(eq(interfaces.nodeId, node.id));
      } else {
        const endpoint = `${creds.url}/devices/${node.deviceId}/ports?columns=port_id,ifName,ifDescr,ifAlias,ifOperStatus,ifLastChange,ifIndex`;
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

        const mappedPorts = ports.map((port: any) => {
          const key = `${node.deviceId}-${port.ifName}`;
          const opticalData = sensorMap.get(key) || {};

          return {
            nodeId: node.id,
            id: port.port_id,
            ifIndex: port.ifIndex,
            ifName: port.ifName,
            ifDescr: port.ifAlias,
            ifOperStatus: port.ifOperStatus === "up" ? 1 : 2,
            lastChange: port.ifLastChange
              ? new Date(port.ifLastChange * 1000)
              : null,
            opticalTx: opticalData.opticalTx || null,
            opticalRx: opticalData.opticalRx || null,
          };
        });
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
