import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: integer("devices_id").notNull(),
  name: text("name").notNull(),
  popLocation: text("pop_location"),
  lat: text("lat"),
  lng: text("lng"),
  ipMgmt: text("ip_mgmt").notNull().unique(),
  snmpCommunity: text("snmp_community").notNull(),
  status: integer("status"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(new Date()),
});

export const interfaces = sqliteTable(
  "interfaces",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    ifIndex: integer("if_index").notNull(),
    ifName: text("if_name"),
    ifDescr: text("if_descr"),
    ifOperStatus: integer("if_oper_status"),
    opticalTx: text("optical_tx"),
    opticalRx: text("optical_rx"),
    sfpInfo: text("sfp_info", { mode: "json" }),
    lastChange: integer("last_change", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
  },
  (table) => {
    return {
      nodeIdIfIndexUnq: uniqueIndex("node_id_if_index_unq").on(
        table.nodeId,
        table.ifIndex,
      ),
    };
  },
);

export const fdb = sqliteTable(
  "fdb",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fdbId: integer("ports_fdb_id").notNull().unique(),
    portId: integer("port_id").notNull(),
    macAddress: text("mac_address").notNull(),
    vlanId: integer("vlan_id").notNull(),
    deviceId: integer("device_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => {
    return {
      macAddressIdx: index("mac_address_idx").on(table.macAddress),
    };
  },
);

export const connections = sqliteTable(
  "connections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    macAddressCount: integer("mac_address_count").notNull(),
    deviceAId: integer("device_a_id").notNull(),
    portAId: integer("port_a_id").notNull(),
    deviceBId: integer("device_b_id").notNull(),
    portBId: integer("port_b_id").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
  },
  (table) => {
    return {
      connectionUnq: uniqueIndex("connection_unq").on(
        table.deviceAId,
        table.portAId,
        table.deviceBId,
        table.portBId,
      ),
    };
  },
);

export const customRoutes = sqliteTable(
  "custom_routes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    coordinates: text("coordinates", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(new Date()),
  },
  (table) => {
    return {
      connectionIdUnq: uniqueIndex("connection_id_unq").on(table.connectionId),
    };
  },
);

export const nodesRelations = relations(nodes, ({ many }) => ({
  interfaces: many(interfaces),
}));

export const interfacesRelations = relations(interfaces, ({ one }) => ({
  node: one(nodes, {
    fields: [interfaces.nodeId],
    references: [nodes.id],
  }),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  customRoute: one(customRoutes, {
    fields: [connections.id],
    references: [customRoutes.connectionId],
  }),
}));

export const customRoutesRelations = relations(customRoutes, ({ one }) => ({
  connection: one(connections, {
    fields: [customRoutes.connectionId],
    references: [connections.id],
  }),
}));
