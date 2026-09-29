# Running a Community Kora Node

This guide enables community members to run their own Soroban/Stellar infrastructure (RPC node, indexer instance) supporting Kora, reducing protocol reliance on any single centralized provider and strengthening decentralization.

---

## Why Run a Node?

**Protocol Resilience:** Independent nodes reduce single points of failure.  
**Decentralization:** Community-run infrastructure aligns with Kora's values.  
**Verification:** Cross-check canonical indexer output against your own.  
**Self-Sovereignty:** Don't rely on third-party RPC availability.

---

## Architecture Overview

```
Stellar Core Node → Soroban RPC → Kora Indexer → PostgreSQL
                                           ↓
                                    REST API (optional)
```

**What You'll Run:**
1. **Soroban RPC node** (consumes Stellar network data)
2. **Kora Indexer service** (indexes Kora-specific contract events)
3. **PostgreSQL database** (stores indexed data)
4. **Verification tooling** (compares your output with canonical instance)

**What You Won't Run:**
- Stellar Core validator (different scope — this is RPC/indexing, not consensus)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 16 GB | 32+ GB |
| **Storage** | 500 GB SSD | 1+ TB NVMe SSD |
| **Network** | 100 Mbps | 1 Gbps |

**Note:** Storage grows over time (~50-100 GB/month for indexer, more for full RPC history).

### Software Requirements

- **OS:** Linux (Ubuntu 22.04+ or Debian 11+ recommended)
- **Docker:** 24.0+ with Docker Compose
- **Git:** 2.30+
- **PostgreSQL:** 15+ (via Docker or native)
- **Rust:** 1.75+ (if building from source)

### Network Requirements

- Open inbound ports: `8000` (RPC), `5432` (PostgreSQL, if exposing), `8080` (Indexer API, optional)
- Stable internet connection
- No strict firewall blocking Stellar network peers

---

## Step 1: Set Up Soroban RPC Node

### Option A: Using Stellar Quickstart (Docker)

```bash
# Pull Stellar Quickstart image
docker pull stellar/quickstart:latest

# Run Soroban RPC on testnet (for testing)
docker run -d \
  --name stellar-rpc \
  -p 8000:8000 \
  -v stellar-data:/data \
  stellar/quickstart \
  --testnet \
  --enable-soroban-rpc

# For mainnet (production):
docker run -d \
  --name stellar-rpc \
  -p 8000:8000 \
  -v stellar-data:/data \
  stellar/quickstart \
  --pubnet \
  --enable-soroban-rpc
```

**Sync Time:** Initial sync takes 24-48 hours for mainnet, 2-4 hours for testnet.

### Option B: Building from Source

```bash
# Clone Soroban RPC
git clone https://github.com/stellar/soroban-rpc.git
cd soroban-rpc

# Build
make build

# Run
./bin/soroban-rpc \
  --stellar-core-url http://localhost:11626 \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --db-path ./db \
  --port 8000
```

### Verify RPC is Running

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getHealth"
  }'

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}
```

---

## Step 2: Set Up PostgreSQL Database

### Using Docker

```bash
docker run -d \
  --name kora-postgres \
  -e POSTGRES_PASSWORD=your_secure_password \
  -e POSTGRES_USER=kora_indexer \
  -e POSTGRES_DB=kora \
  -p 5432:5432 \
  -v kora-postgres-data:/var/lib/postgresql/data \
  postgres:15-alpine
```

### Create Schema

```bash
# Connect to database
docker exec -it kora-postgres psql -U kora_indexer -d kora

# Run schema creation (provided in services/indexer/schema.sql)
\i /path/to/services/indexer/schema.sql
```

---

## Step 3: Clone and Configure Kora Indexer

### Clone Repository

```bash
git clone https://github.com/kora-finance/contracts.git
cd contracts/services/indexer
```

### Configure Environment

Create `.env` file:

```bash
# RPC Configuration
SOROBAN_RPC_URL=http://localhost:8000
STELLAR_NETWORK=mainnet  # or 'testnet'

# Database Configuration
DATABASE_URL=postgresql://kora_indexer:your_secure_password@localhost:5432/kora

# Indexer Configuration
START_LEDGER=auto  # or specific ledger number
BATCH_SIZE=100
POLL_INTERVAL_MS=5000

# Contract Addresses (mainnet)
MARKETPLACE_CONTRACT=CA...
TREASURY_CONTRACT=CB...
FINANCING_POOL_CONTRACT=CC...
INVOICE_NFT_CONTRACT=CD...
GOVERNANCE_CONTRACT=CE...
RISK_REGISTRY_CONTRACT=CF...
PRICE_ORACLE_CONTRACT=CG...
VESTING_CONTRACT=CH...

# Optional: API Server
ENABLE_API=true
API_PORT=8080
```

**Contract Addresses:** Obtain from official Kora documentation or deployment records.

### Build Indexer

```bash
# Install dependencies
cargo build --release

# Verify build
./target/release/kora-indexer --version
```

---

## Step 4: Run the Indexer

### Start Indexer Service

```bash
# Run in foreground (for testing)
./target/release/kora-indexer

# Run as systemd service (production)
sudo systemctl start kora-indexer
sudo systemctl enable kora-indexer
```

### Systemd Service File

Create `/etc/systemd/system/kora-indexer.service`:

```ini
[Unit]
Description=Kora Protocol Indexer
After=network.target postgresql.service docker.service
Requires=postgresql.service

[Service]
Type=simple
User=kora
WorkingDirectory=/home/kora/contracts/services/indexer
EnvironmentFile=/home/kora/contracts/services/indexer/.env
ExecStart=/home/kora/contracts/services/indexer/target/release/kora-indexer
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Monitor Logs

```bash
# Docker logs
docker logs -f kora-indexer

# Systemd logs
journalctl -u kora-indexer -f

# Check indexing progress
curl http://localhost:8080/health
```

---

## Step 5: Verify Your Node

### Cross-Verification Tool

Use the provided verification script to compare your indexer output with the canonical instance:

```bash
cd tools
./verify-indexer.sh \
  --local-db postgresql://localhost:5432/kora \
  --canonical-api https://api.kora.finance \
  --start-ledger 1000000 \
  --end-ledger 1001000
```

### Manual Verification

```bash
# Query your local indexer
curl http://localhost:8080/api/v1/invoices | jq .

# Query canonical indexer
curl https://api.kora.finance/api/v1/invoices | jq .

# Compare outputs (should match for same ledger range)
diff <(curl -s http://localhost:8080/api/v1/invoices | jq -S .) \
     <(curl -s https://api.kora.finance/api/v1/invoices | jq -S .)
```

### Expected Consistency

- **Event counts** should match exactly for the same ledger range
- **Transaction hashes** should be identical
- **State snapshots** (balances, positions) should converge
- **Small discrepancies** during sync are normal; should resolve after sync completes

---

## Maintenance & Operations

### Regular Tasks

| Task | Frequency | Command |
|------|-----------|---------|
| **Check sync status** | Daily | `curl localhost:8080/health` |
| **Backup database** | Weekly | `pg_dump kora > kora_backup.sql` |
| **Update RPC node** | Monthly | `docker pull stellar/quickstart:latest && docker restart stellar-rpc` |
| **Update indexer** | On release | `git pull && cargo build --release && systemctl restart kora-indexer` |
| **Monitor disk usage** | Weekly | `df -h` |
| **Verify against canonical** | Weekly | `./tools/verify-indexer.sh` |

### Health Checks

```bash
# RPC health
curl http://localhost:8000 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# PostgreSQL health
docker exec kora-postgres pg_isready -U kora_indexer

# Indexer health
curl http://localhost:8080/health
```

### Common Issues

#### Issue: Indexer falling behind

**Symptoms:** `current_ledger` not advancing, high CPU usage  
**Solution:**
- Increase `BATCH_SIZE` in config
- Reduce `POLL_INTERVAL_MS`
- Check RPC node sync status
- Scale up hardware (CPU/RAM)

#### Issue: RPC node out of sync

**Symptoms:** Indexer errors, missing events  
**Solution:**
- Check RPC health: `curl localhost:8000/health`
- Restart RPC: `docker restart stellar-rpc`
- Check disk space: `df -h`
- Review Stellar Core logs

#### Issue: Database connection errors

**Symptoms:** `connection refused`, `too many connections`  
**Solution:**
- Verify PostgreSQL is running: `docker ps`
- Check connection string in `.env`
- Increase PostgreSQL `max_connections` if needed
- Check firewall rules

---

## Security Best Practices

### Network Security

- **Firewall:** Only expose necessary ports (8000 for RPC, 8080 for API)
- **TLS:** Use TLS/SSL for API endpoints (nginx reverse proxy recommended)
- **Authentication:** Add API key authentication for public API access

### Database Security

- **Strong passwords:** Use generated passwords, not default/simple ones
- **Restrict access:** Bind PostgreSQL to `localhost` only unless remote access needed
- **Regular backups:** Automated daily backups with off-site storage
- **Encryption:** Enable encryption at rest for sensitive data

### System Security

- **Updates:** Keep OS, Docker, and dependencies updated
- **Monitoring:** Set up alerting for downtime/issues (Prometheus, Grafana, etc.)
- **Access control:** Use dedicated user account, not root
- **Logging:** Centralize logs for audit trail

---

## Resource Monitoring

### Metrics to Track

- **RPC sync lag:** Ledger difference between RPC and network
- **Indexer lag:** Ledger difference between indexer and RPC
- **Database size:** Monitor growth rate
- **API response time:** P50, P95, P99 latencies
- **Error rates:** Failed RPC calls, indexing errors

### Monitoring Stack (Optional)

```bash
# Prometheus + Grafana for metrics
docker-compose -f docker-compose.monitoring.yml up -d

# Access Grafana: http://localhost:3000
# Import Kora dashboard: grafana-dashboard.json
```

---

## Upgrading Your Node

### Indexer Updates

```bash
cd contracts/services/indexer
git fetch origin
git checkout vX.Y.Z  # or main for latest

cargo build --release
sudo systemctl restart kora-indexer

# Verify health
curl localhost:8080/health
```

### RPC Updates

```bash
# Pull latest image
docker pull stellar/quickstart:latest

# Stop old container
docker stop stellar-rpc

# Start new container (same command as initial setup)
docker run -d --name stellar-rpc ...

# Verify
curl localhost:8000/health
```

### Database Migrations

```bash
# Run migration scripts (if provided with update)
psql -U kora_indexer -d kora -f services/indexer/migrations/vX.Y.Z.sql
```

---

## Troubleshooting Guide

### Symptom: High Memory Usage

**Check:**
- RPC cache size (`--db-cache-size` flag)
- PostgreSQL `shared_buffers` setting
- Indexer batch size

**Fix:**
- Reduce RPC cache size
- Tune PostgreSQL memory settings
- Lower `BATCH_SIZE` in indexer config

### Symptom: Slow Query Performance

**Check:**
- Database indexes (run `EXPLAIN ANALYZE` on slow queries)
- Table bloat (`pg_stat_user_tables`)
- Connection pool size

**Fix:**
- Add missing indexes (see `schema.sql`)
- Run `VACUUM ANALYZE` regularly
- Increase connection pool size if needed

### Symptom: Disk Space Exhaustion

**Check:**
- RPC history retention (`--history-retention-count`)
- PostgreSQL WAL files
- Indexer log files

**Fix:**
- Reduce RPC history retention
- Configure PostgreSQL archive mode
- Rotate/compress log files

---

## Community & Support

### Report Issues

- **GitHub Issues:** https://github.com/kora-finance/contracts/issues
- **Discord:** https://discord.gg/kora-finance
- **Documentation:** https://docs.kora.finance

### Share Your Experience

Successfully running a node? Share your experience:
- Open a PR adding your node to `COMMUNITY_NODES.md`
- Share setup improvements or automation scripts
- Report documentation issues or unclear steps

### Node Operator Registry

Register your node (optional) for community visibility:

```bash
# Submit PR adding your node details to COMMUNITY_NODES.md
- **Operator:** Your Name/Organization
- **Location:** City, Country
- **Network:** Mainnet / Testnet
- **API Endpoint:** https://your-node.example.com (if public)
- **Contact:** email or Discord handle
```

---

## Advanced Configurations

### High-Availability Setup

For production deployments, consider:
- **Load balancing:** Multiple indexer instances behind nginx/HAProxy
- **Database replication:** PostgreSQL primary-replica setup
- **Redundant RPC nodes:** Multiple RPC endpoints with failover
- **Monitoring and alerting:** PagerDuty, Opsgenie integration

### Performance Tuning

```bash
# PostgreSQL tuning (postgresql.conf)
shared_buffers = 8GB              # 25% of total RAM
effective_cache_size = 24GB       # 75% of total RAM
work_mem = 64MB
maintenance_work_mem = 1GB
max_connections = 200
checkpoint_completion_target = 0.9

# RPC tuning (soroban-rpc flags)
--db-cache-size=4096              # MB
--history-retention-count=10000   # ledgers
--max-rpc-workers=16              # concurrent requests

# Indexer tuning (.env)
BATCH_SIZE=500
POLL_INTERVAL_MS=1000
MAX_CONCURRENT_REQUESTS=20
```

---

## Acknowledgments

Thank you for contributing to Kora Protocol decentralization by running an independent node. Your participation strengthens the network's resilience and trustworthiness.

---

## Appendices

### A. Full Docker Compose Example

See `docker-compose.community-node.yml` in repository root.

### B. Systemd Service Files

See `systemd/` directory for complete service definitions.

### C. Verification Script Source

See `tools/verify-indexer.sh` for cross-verification implementation.

### D. Grafana Dashboard

See `monitoring/grafana-dashboard.json` for pre-configured metrics dashboard.
