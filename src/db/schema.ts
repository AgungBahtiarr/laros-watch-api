import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
  boolean,
  jsonb,
  real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  deviceId: integer("devices_id").notNull(),
  name: text("name").notNull(),
  popLocation: text("pop_location"),
  lat: text("lat"),
  lng: text("lng"),
  ipMgmt: text("ip_mgmt").notNull().unique(),
  snmpCommunity: text("snmp_community").notNull(),
  status: boolean("status"),
  os: text("os"),
  cpuUsage: real("cpu_usage"),
  ramUsage: real("ram_usage"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const interfaces = pgTable(
  "interfaces",
  {
    id: serial("id").primaryKey(),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    ifIndex: integer("if_index").notNull(),
    ifName: text("if_name"),
    ifDescr: text("if_descr"),
    ifType: text("if_type"),
    ifPhysAddress: text("if_phys_address"),
    ifOperStatus: integer("if_oper_status"),
    opticalTx: text("optical_tx"),
    opticalRx: text("optical_rx"),
    sfpInfo: jsonb("sfp_info"),
    lastChange: timestamp("last_change"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

export const fdb = pgTable(
  "fdb",
  {
    id: serial("id").primaryKey(),
    fdbId: integer("ports_fdb_id").notNull().unique(),
    portId: integer("port_id").notNull(),
    macAddress: text("mac_address").notNull(),
    vlanId: integer("vlan_id").notNull(),
    deviceId: integer("device_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => {
    return {
      macAddressIdx: index("mac_address_idx").on(table.macAddress),
    };
  },
);

export const odp = pgTable("odp", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  lat: text("lat"),
  lng: text("lng"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const connections = pgTable(
  "connections",
  {
    id: serial("id").primaryKey(),
    deviceAId: integer("device_a_id").notNull(),
    portAId: integer("port_a_id").notNull(),
    deviceBId: integer("device_b_id").notNull(),
    portBId: integer("port_b_id").notNull(),
    odpId: integer("odp_id").references(() => odp.id),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

export const customRoutes = pgTable(
  "custom_routes",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    coordinates: jsonb("coordinates").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  odp: one(odp, {
    fields: [connections.odpId],
    references: [odp.id],
  }),
}));

export const customRoutesRelations = relations(customRoutes, ({ one }) => ({
  connection: one(connections, {
    fields: [customRoutes.connectionId],
    references: [connections.id],
  }),
}));

export const odpRelations = relations(odp, ({ many }) => ({
  connections: many(connections),
}));

export const lldp = pgTable(
  "lldp",
  {
    id: serial("id").primaryKey(),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    localDeviceName: text("local_device_name"),
    localPortDescription: text("local_port_description"),
    localPortIfIndex: integer("local_port_if_index"),
    remoteChassisIdSubtypeCode: integer("remote_chassis_id_subtype_code"),
    remoteChassisIdSubtypeName: text("remote_chassis_id_subtype_name"),
    remoteChassisId: text("remote_chassis_id"),
    remotePortIdSubtypeCode: integer("remote_port_id_subtype_code"),
    remotePortIdSubtypeName: text("remote_port_id_subtype_name"),
    remotePortId: text("remote_port_id"),
    remotePortDescription: text("remote_port_description"),
    remoteSystemName: text("remote_system_name"),
    remoteSystemDescription: text("remote_system_description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      nodeIdLocalPortIfIndexUnq: uniqueIndex(
        "node_id_local_port_if_index_unq",
      ).on(table.nodeId, table.localPortIfIndex),
    };
  },
);

export const lldpRelations = relations(lldp, ({ one }) => ({
  node: one(nodes, {
    fields: [lldp.nodeId],
    references: [nodes.id],
  }),
}));
