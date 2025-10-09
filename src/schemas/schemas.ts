import { z } from "@hono/zod-openapi";

export const InterfaceSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  nodeId: z.number().openapi({
    example: 1,
  }),
  ifIndex: z.number().openapi({
    example: 1,
  }),
  ifName: z.string().openapi({
    example: "ether1",
  }),
  ifDescr: z.string().openapi({
    example: "Uplink to Core",
  }),
  ifType: z.string().openapi({
    example: "ethernetCsmacd",
  }),
  ifPhysAddress: z.string().openapi({
    example: "00:11:22:33:44:55",
  }),
  ifOperStatus: z.number().openapi({
    example: 1,
  }),
  opticalTx: z.string().nullable().openapi({
    example: "-5.0",
  }),
  opticalRx: z.string().nullable().openapi({
    example: "-4.5",
  }),
  sfpInfo: z.any().nullable().openapi({
    example: null,
  }),
  lastChange: z.string().datetime().nullable().openapi({
    example: "2025-09-15T10:00:00Z",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
});

export const NodeSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  deviceId: z.number().openapi({
    example: 123,
  }),
  name: z.string().openapi({
    example: "Core-Router-1",
  }),
  popLocation: z.string().nullable().openapi({
    example: "Main POP",
  }),
  lat: z.string().nullable().openapi({
    example: "-6.175110",
  }),
  lng: z.string().nullable().openapi({
    example: "106.865036",
  }),
  ipMgmt: z.string().openapi({
    example: "192.168.1.1",
  }),
  snmpCommunity: z.string().openapi({
    example: "public",
  }),
  status: z.boolean().openapi({
    example: true,
  }),
  os: z.string().nullable().openapi({
    example: "RouterOS",
  }),
  cpuUsage: z.number().nullable().openapi({
    example: 10.5,
  }),
  ramUsage: z.number().nullable().openapi({
    example: 25.0,
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  interfaces: z.array(InterfaceSchema).optional(),
});

export const NodesSchema = z.array(NodeSchema);

export const DomainSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  name: z.string().openapi({
    example: "example.com",
  }),
  whois: z.any().nullable().openapi({
    example: null,
  }),
  status: z.string().nullable().openapi({
    example: "ok",
  }),
  expiresAt: z.string().datetime().nullable().openapi({
    example: "2026-09-15T09:00:00Z",
  }),
  lastChangedAt: z.string().datetime().nullable().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
});

export const DomainsSchema = z.array(DomainSchema);

export const OdpSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  name: z.string().openapi({
    example: "ODP-01",
  }),
  location: z.string().nullable().openapi({
    example: "Main Street",
  }),
  lat: z.string().nullable().openapi({
    example: "-6.175110",
  }),
  lng: z.string().nullable().openapi({
    example: "106.865036",
  }),
  notes: z.string().nullable().openapi({
    example: "Notes about this ODP",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
});

export const OdpsSchema = z.array(OdpSchema);

export const CustomRouteSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  connectionId: z.number().openapi({
    example: 1,
  }),
  coordinates: z.any().openapi({
    example: [],
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
});

export const ConnectionSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  deviceAId: z.number().openapi({
    example: 1,
  }),
  portAId: z.number().openapi({
    example: 1,
  }),
  deviceBId: z.number().openapi({
    example: 2,
  }),
  portBId: z.number().openapi({
    example: 1,
  }),
  odpPath: z
    .array(z.number())
    .nullable()
    .openapi({
      example: [1, 2],
    }),
  description: z.string().nullable().openapi({
    example: "Connection between two devices",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2025-09-15T09:00:00Z",
  }),
  customRoute: CustomRouteSchema.optional(),
});

export const ConnectionsSchema = z.array(ConnectionSchema);

export const LldpDataSchema = z.object({
  nodeId: z.number(),
  nodeName: z.string(),
  localPortIfIndex: z.number(),
  remoteChassisId: z.string(),
  remotePortId: z.string(),
});

export const SyncResponseSchema = z.object({
  message: z.string(),
  successfulDevices: z.number().optional(),
  failedDevices: z.number().optional(),
  syncedCount: z.number().optional(),
  data: z.array(z.any()).optional(),
});

export const VlanInterfaceSchema = z.object({
  id: z.number(),
  nodeId: z.number(),
  vlanId: z.number(),
  interfaceId: z.number(),
  isTagged: z.boolean(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  node: NodeSchema.pick({ id: true, name: true, ipMgmt: true, os: true }),
  interface: InterfaceSchema.pick({ id: true, ifName: true, ifDescr: true }),
});

export const VlanSummarySchema = z.object({
  vlanId: z.number(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  tagged: z.array(
    InterfaceSchema.pick({ id: true, ifName: true, ifDescr: true }),
  ),
  untagged: z.array(
    InterfaceSchema.pick({ id: true, ifName: true, ifDescr: true }),
  ),
});

export const WebhookSchema = z.object({
  from: z.string(),
  message: z.object({
    text: z.string(),
  }),
});

export const WebhookResponseSchema = z.object({
  status: z.string(),
  reply_sent: z.boolean(),
  reason: z.string().optional(),
});
