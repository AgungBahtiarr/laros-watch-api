# Laros Watch API

Network monitoring API built with Hono, TypeScript, and PostgreSQL for monitoring network devices via SNMP and LibreNMS integration.

## Installation

To install dependencies:
```sh
bun install
```

## Development

To run in development mode:
```sh
bun run dev
```

The API will be available at http://localhost:3000

## Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/database

# LibreNMS API
LIBRENMS_API_URL=https://your-librenms-instance/api/v0
LIBRENMS_API_TOKEN=your-api-token

# WhatsApp Notifications (optional)
WA_API_URL=your-whatsapp-api-url
WA_GROUP_ID=your-group-id
WA_USERNAME=your-username
WA_PASSWORD=your-password
```

## API Endpoints

### Sync Operations

#### POST `/sync/sync`
Synchronizes devices (nodes) from LibreNMS, including SNMP monitoring for CPU and RAM usage.

**Query Parameters:**
- `timeout` (optional): SNMP timeout in milliseconds (default: 8000ms, max: 30000ms, min: 1000ms)

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/sync?timeout=10000"
```

#### POST `/sync/transport`
Full synchronization with notifications - syncs both nodes and interfaces, then sends WhatsApp notifications for status changes.

**Query Parameters:**
- `timeout` (optional): SNMP timeout in milliseconds for node monitoring

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/transport?timeout=12000"
```

#### POST `/sync/sync/interfaces`
Synchronizes network interfaces from LibreNMS.

#### POST `/sync/lldp/sync`
Synchronizes LLDP (Link Layer Discovery Protocol) data from network devices.

#### POST `/sync/test/huawei/:ip`
Tests available SNMP OIDs for a specific Huawei device to help troubleshoot monitoring issues.

**Parameters:**
- `ip`: Device IP address (required)

**Query Parameters:**
- `community`: SNMP community string (default: "public")

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/test/huawei/192.168.1.1?community=public"
```

**Response includes:**
- List of working CPU and RAM OIDs
- Total number of OIDs tested
- Recommendations for configuration optimization

#### POST `/sync/test/huawei/ce/:ip`
Tests CE series specific SNMP OIDs for Huawei CloudEngine switches.

**Parameters:**
- `ip`: CE switch IP address (required)

**Query Parameters:**
- `community`: SNMP community string (default: "public")

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/test/huawei/ce/172.16.100.4?community=public"
```

**Response includes:**
- CE series specific CPU and memory OID test results
- Working OID count and recommendations
- Detailed status for each tested OID

#### POST `/sync/test/snmp/:ip`
Tests basic SNMP connectivity and protocol versions for any device.

**Parameters:**
- `ip`: Device IP address (required)

**Query Parameters:**
- `community`: SNMP community string (default: "public")

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/test/snmp/172.16.100.4?community=public"
```

**Response includes:**
- SNMP connectivity status
- Supported SNMP versions (v1, v2c)
- System description from device
- Troubleshooting recommendations

#### POST `/sync/test/discover/:ip`
Discovers all available OIDs on a device for advanced troubleshooting.

**Parameters:**
- `ip`: Device IP address (required)

**Query Parameters:**
- `community`: SNMP community string (default: "public")

**Example:**
```bash
curl -X POST "http://localhost:3000/sync/test/discover/172.16.100.4?community=public"
```

**Response includes:**
- Total OIDs discovered
- CPU and memory related OIDs
- Full OID list (limited for readability)
- Recommendations for monitoring setup

## Database Operations

```sh
# Generate and run migrations
bun run db:migrate

# Push schema changes
bun run db:push

# Open Drizzle Studio
bun run db:studio
```

## SNMP Timeout Configuration

The API includes intelligent timeout handling for SNMP operations:

- **Default timeout**: 8 seconds
- **Minimum timeout**: 1 second
- **Maximum timeout**: 30 seconds
- **Automatic retry**: Failed devices are cached and skipped temporarily
- **Performance optimization**: Successful OIDs are cached for faster subsequent queries

### Timeout Behavior

- Devices that fail SNMP queries are temporarily marked as failed
- The system skips recently failed devices to improve overall performance
- Timeout values are validated and clamped to safe ranges
- Detailed logging shows timing information for troubleshooting

### Troubleshooting Huawei Devices

If Huawei devices show null CPU/RAM values or timeout errors:

1. **Test basic connectivity first:**
   ```bash
   # Test SNMP connectivity and versions
   curl -X POST "http://localhost:3000/sync/test/snmp/DEVICE_IP?community=COMMUNITY"
   ```

2. **Test specific device types:**
   ```bash
   # General Huawei test
   curl -X POST "http://localhost:3000/sync/test/huawei/DEVICE_IP?community=COMMUNITY"
   
   # CE series specific test (recommended for CE switches)
   curl -X POST "http://localhost:3000/sync/test/huawei/ce/DEVICE_IP?community=COMMUNITY"
   ```

3. **Discover available OIDs (advanced troubleshooting):**
   ```bash
   # Discover all OIDs available on device
   curl -X POST "http://localhost:3000/sync/test/discover/DEVICE_IP?community=COMMUNITY"
   ```

4. **Common timeout issues:**
   - Test basic connectivity with `/sync/test/snmp/` endpoint first
   - Reduce SNMP timeout: use `timeout=5000` in sync requests
   - Check network latency between server and device
   - Verify SNMP community string and version (SNMPv2c recommended)
   - Check firewall rules and UDP port 161 accessibility

5. **Check common issues:**
   - Verify SNMP community string is correct
   - Ensure SNMP is enabled on the device
   - Check if device supports the required MIB modules
   - Verify network connectivity and firewall settings
   - Test with different SNMP versions (v1 vs v2c)

6. **CE series specific notes:**
   - CE switches use specific OIDs: `1.3.6.1.4.1.2011.6.1.3.x.x.x`
   - Standard hrProcessorLoad may timeout on CE series
   - Use CE-specific test endpoint for best results
   - If all CE OIDs timeout, check basic SNMP connectivity first

7. **The system includes optimized approaches:**
   - Prioritizes device-specific OIDs over generic ones
   - Uses reduced timeouts and no retries to prevent duplicate requests
   - Caches working OIDs for better performance
   - Supports various Huawei models (S-series, AR-series, CE-series, NE-series)

## Docker

Run with Docker Compose:
```sh
docker-compose up -d
```
