import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
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

export const nodesRelations = relations(nodes, ({ many }) => ({
  interfaces: many(interfaces),
}));

export const interfacesRelations = relations(interfaces, ({ one }) => ({
  node: one(nodes, {
    fields: [interfaces.nodeId],
    references: [nodes.id],
  }),
}));
