# Laros Watch API Documentation

This document provides an overview of the available API endpoints for the Laros Watch application.

## Base URL

The base URL for all API endpoints is `http://localhost:3000/api/nodes`.

---

## Endpoints

### 1. `GET /api/nodes`

**Description:** Retrieves a list of all nodes (devices) currently stored in the database, including their associated interfaces.

**Request:**
- Method: `GET`
- Path: `/api/nodes`
- Headers: None
- Body: None

**Response (Success - 200 OK):**
```json
[
  {
    "id": 1,
    "deviceId": 123,
    "name": "Router-A",
    "popLocation": "Jakarta",
    "lat": "-6.200000",
    "lng": "106.800000",
    "ipMgmt": "192.168.1.1",
    "snmpCommunity": "public",
    "status": 1,
    "createdAt": "2025-07-10T10:00:00.000Z",
    "updatedAt": "2025-07-10T10:00:00.000Z",
    "interfaces": [
      {
        "id": 101,
        "nodeId": 1,
        "ifIndex": 1,
        "ifName": "GigabitEthernet0/1",
        "ifDescr": "Uplink to Core",
        "ifOperStatus": 1,
        "opticalTx": "-5.0",
        "opticalRx": "-7.0",
        "sfpInfo": null,
        "lastChange": "2025-07-10T09:50:00.000Z",
        "createdAt": "2025-07-10T10:00:00.000Z",
        "updatedAt": "2025-07-10T10:00:00.000Z"
      }
    ]
  },
  {
    "id": 2,
    "deviceId": 456,
    "name": "Switch-B",
    "popLocation": "Bandung",
    "lat": "-6.900000",
    "lng": "107.600000",
    "ipMgmt": "192.168.1.2",
    "snmpCommunity": "public",
    "status": 0,
    "createdAt": "2025-07-10T10:05:00.000Z",
    "updatedAt": "2025-07-10T10:05:00.000Z",
    "interfaces": []
  }
]
```

---

### 2. `GET /api/nodes/:id`

**Description:** Retrieves detailed information for a single node (device) by its ID, including its associated interfaces.

**Request:**
- Method: `GET`
- Path: `/api/nodes/{id}` (e.g., `/api/nodes/1`)
- Headers: None
- Body: None

**Path Parameters:**
- `id` (integer): The unique identifier of the node.

**Response (Success - 200 OK):**
```json
{
  "id": 1,
  "deviceId": 123,
  "name": "Router-A",
  "popLocation": "Jakarta",
  "lat": "-6.200000",
  "lng": "106.800000",
  "ipMgmt": "192.168.1.1",
  "snmpCommunity": "public",
  "status": 1,
  "createdAt": "2025-07-10T10:00:00.000Z",
  "updatedAt": "2025-07-10T10:00:00.000Z",
  "interfaces": [
    {
      "id": 101,
      "nodeId": 1,
      "ifIndex": 1,
      "ifName": "GigabitEthernet0/1",
      "ifDescr": "Uplink to Core",
      "ifOperStatus": 1,
      "opticalTx": "-5.0",
      "opticalRx": "-7.0",
      "sfpInfo": null,
      "lastChange": "2025-07-10T09:50:00.000Z",
      "createdAt": "2025-07-10T10:00:00.000Z",
      "updatedAt": "2025-07-10T10:00:00.000Z"
    }
  ]
}
```

**Response (Error - 404 Not Found):**
```json
{
  "error": "Node not found"
}
```

---

### 3. `POST /api/nodes/transport`

**Description:** Triggers a full synchronization of nodes and interfaces from LibreNMS and sends a WhatsApp notification if any status changes are detected. This endpoint orchestrates the `syncNodes` and `syncInterfaces` services and then uses the `sendChangeNotification` service.

**Request:**
- Method: `POST`
- Path: `/api/nodes/transport`
- Headers: None
- Body: None

**Environment Variables Required:**
- `LIBRENMS_API_URL`: The base URL for the LibreNMS API.
- `LIBRENMS_API_TOKEN`: The API token for authentication with LibreNMS.
- `WA_API_URL`: The base URL for the WhatsApp API.
- `WA_GROUP_ID`: The WhatsApp group ID to send notifications to.
- `WA_USERNAME`: The username for WhatsApp API authentication.
- `WA_PASSWORD`: The password for WhatsApp API authentication.

**Response (Success - 200 OK):**
```json
{
  "success": true,
  "notification_sent": true,
  "data_sent": {
    "nodeChanges": [
      {
        "name": "Router-A",
        "ipMgmt": "192.168.1.1",
        "previous_status": "DOWN",
        "current_status": "UP"
      }
    ],
    "interfaceChanges": [
      {
        "name": "GigabitEthernet0/1",
        "description": "Uplink to Core",
        "nodeName": "Router-A",
        "previous_status": "DOWN",
        "current_status": "UP"
      }
    ]
  }
}
```
Or if no changes:
```json
{
  "success": true,
  "notification_sent": false,
  "reason": "No status changes detected."
}
```

**Response (Error - 500 Internal Server Error):**
```json
{
  "message": "API credentials for LibreNMS are not configured."
}
```
Or:
```json
{
  "message": "Failed to send notification via WhatsApp."
}
```

---

### 4. `POST /api/nodes/webhook`

**Description:** Handles incoming webhooks, primarily from a WhatsApp bot. It processes messages and sends replies based on predefined commands (e.g., `!devices`, `!deviceinfo`).

**Request:**
- Method: `POST`
- Path: `/api/nodes/webhook`
- Headers: `Content-Type: application/json`

**Request Body (Example):**
```json
{
  "from": "1234567890@s.whatsapp.net",
  "message": {
    "text": "!devices"
  }
}
```

**Environment Variables Required:**
- `WA_API_URL`: The base URL for the WhatsApp API.
- `WA_USERNAME`: The username for WhatsApp API authentication.
- `WA_PASSWORD`: The password for WhatsApp API authentication.
- `WA_DEVICE_SESSION`: (Optional) The device session for WhatsApp API.

**Response (Success - 200 OK):**
```json
{
  "status": "success",
  "reply_sent": true
}
```
Or if no reply was sent:
```json
{
  "status": "success",
  "reply_sent": false,
  "reason": "No matching keyword or invalid format."
}
```

**Response (Error - 500 Internal Server Error):**
```json
{
  "message": "Webhook error: <error_details>"
}
```

---

### 5. `GET /api/nodes/status/events`

**Description:** Establishes a Server-Sent Events (SSE) connection to push real-time notifications to connected clients whenever there are changes in node or interface status (e.g., after a `POST /transport` call).

**Request:**
- Method: `GET`
- Path: `/api/nodes/status/events`
- Headers: None
- Body: None

**Response (Event Stream):**
- `event: heartbeat` (sent every 25 seconds to keep the connection alive)
  ```
  event: heartbeat
  data: ping
  id: <timestamp>
  ```
- `event: notification` (sent when `db-updated` event is emitted)
  ```
  event: notification
  data: {"nodeChanges":[{"name":"Router-A","ipMgmt":"192.168.1.1","previous_status":"DOWN","current_status":"UP"}],"interfaceChanges":[]}
  id: update-<timestamp>
  ```

---

### 6. `POST /api/nodes/sync`

**Description:** Synchronizes node (device) data from LibreNMS into the local database. This endpoint is now handled by the `syncNodes` service.

**Request:**
- Method: `POST`
- Path: `/api/nodes/sync`
- Headers: None
- Body: None

**Environment Variables Required:**
- `LIBRENMS_API_URL`: The base URL for the LibreNMS API.
- `LIBRENMS_API_TOKEN`: The API token for authentication with LibreNMS.

**Response (Success - 200 OK):**
```json
{
  "message": "Node sync with LibreNMS completed successfully.",
  "syncedCount": 2,
  "changes": [
    {
      "name": "Router-A",
      "ipMgmt": "192.168.1.1",
      "previous_status": "DOWN",
      "current_status": "UP"
    }
  ]
}
```
Or if no devices found:
```json
{
  "message": "Sync finished. No devices found in LibreNMS.",
  "syncedCount": 0,
  "changes": []
}
```

**Response (Error - 500 Internal Server Error):**
```json
{
  "message": "API credentials for LibreNMS are not configured."
}
```
Or:
```json
{
  "message": "Failed to fetch from LibreNMS: <error_details>"
}
```
Or:
```json
{
  "message": "An internal server error occurred during node sync."
}
```

---

### 7. `POST /api/nodes/sync/interfaces`

**Description:** Synchronizes interface data for all nodes from LibreNMS into the local database. This endpoint is now handled by the `syncInterfaces` service.

**Request:**
- Method: `POST`
- Path: `/api/nodes/sync/interfaces`
- Headers: None
- Body: None

**Environment Variables Required:**
- `LIBRENMS_API_URL`: The base URL for the LibreNMS API.
- `LIBRENMS_API_TOKEN`: The API token for authentication with LibreNMS.

**Response (Success - 200 OK):**
```json
{
  "message": "Smart interface sync completed successfully.",
  "changes": [
    {
      "name": "GigabitEthernet0/1",
      "description": "Uplink to Core",
      "nodeName": "Router-A",
      "previous_status": "DOWN",
      "current_status": "UP"
    }
  ]
}
```
Or if no nodes found in local DB:
```json
{
  "message": "No nodes found in local DB.",
  "changes": []
}
```

**Response (Error - 500 Internal Server Error):**
```json
{
  "message": "API credentials for LibreNMS are not configured."
}
```
Or:
```json
{
  "message": "An internal server error occurred during interface sync."
}
```
