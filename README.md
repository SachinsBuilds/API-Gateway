#  Custom API Gateway

### A Multi-Tenant API Gateway with Authentication, Dynamic Rate Limiting & Reverse Proxying

A lightweight API Gateway built from scratch using Node.js and native HTTP modules to explore the internal architecture of modern API gateways.

This project demonstrates how incoming API requests can be authenticated, associated with individual tenants, rate-limited according to tenant-specific quotas, and securely routed to internal microservices through a centralized gateway.

Instead of allowing clients to communicate directly with backend services, the gateway acts as a single entry point for request processing and traffic management.

---

##  Overview

Modern backend architectures often consist of multiple independent services.

As the number of services grows, managing authentication, traffic limits, routing, and tenant isolation independently becomes increasingly difficult.

This project explores how an API Gateway can centralize these responsibilities.

The gateway introduces a tenant-aware request processing pipeline:

```text
                     CLIENT REQUEST
                           |
                           v
                  +------------------+
                  |   API GATEWAY    |
                  |    Port 8000     |
                  +------------------+
                           |
                           v
                  +------------------+
                  |  Route Matching  |
                  +------------------+
                           |
                           v
                  +------------------+
                  | API Key Validation|
                  +------------------+
                           |
                           v
                  +------------------+
                  | Tenant Resolution |
                  +------------------+
                           |
                           v
                  +------------------+
                  |  Rate Limiting   |
                  +------------------+
                           |
                           v
                  +------------------+
                  | Reverse Proxy    |
                  +------------------+
                           |
              +------------+------------+
              |                         |
              v                         v
      +---------------+        +------------------+
      | Auth Service  |        | Telemetry Service|
      |  Port 5001    |        |    Port 5002     |
      +---------------+        +------------------+
              |                         |
              +------------+------------+
                           |
                           v
                   CLIENT RESPONSE
```

The gateway handles the request before it reaches the backend service.

---

##  Features

###  1. API Key Authentication

Every request targeting a registered route must provide a valid API key.

The gateway reads the API key from the `x-api-key` request header and validates it against the project registry.

```http
x-api-key: your_api_key
```

Requests with missing or unregistered API keys are rejected at the gateway boundary.

**Response:**

```json
{
  "error": "401 Unauthorized",
  "message": "Invalid or missing 'x-api-key' footprint at gateway boundary."
}
```

This prevents unauthorized requests from reaching internal microservices.

---

### 🏢 2. Multi-Tenant Architecture

The gateway supports multiple tenants using a centralized project registry.

Each API key is associated with a specific project and its individual request quota.

Example:

```javascript
const PROJECT_REGISTRY = {
    "tenant_alpha_key": {
        projectId: "project_alpha_ecommerce",
        allowedLimits: 5
    },

    "tenant_beta_key": {
        projectId: "project_beta_dashboard",
        allowedLimits: 10
    }
};
```

Each tenant has its own identity and rate-limit bucket.

| Tenant | Project ID | Request Limit |
|--------|------------|---------------|
| Tenant Alpha | project_alpha_ecommerce | 5 requests |
| Tenant Beta | project_beta_dashboard | 10 requests |

The gateway resolves the tenant from the API key instead of trusting a client-provided tenant identifier.

This creates a foundation for tenant-aware traffic management.

---

###  3. Tenant-Based Dynamic Rate Limiting

Different tenants can have different request quotas.

A free-tier tenant might receive a smaller request allowance, while a higher-tier tenant can receive a larger quota.

The gateway determines the applicable limit dynamically:

```javascript
const tenantId = clientProfile.projectId;
const tenantLimit = clientProfile.allowedLimits;
```

Rate-limit state is maintained separately for each tenant:

```javascript
const RateLimitCache = {};
```

This means one tenant's request activity does not directly consume another tenant's rate-limit bucket.

**Example:**

```text
Tenant Alpha
-------------
Allowed Requests: 5
Window: 10 Seconds

Request 1  -> Allowed
Request 2  -> Allowed
Request 3  -> Allowed
Request 4  -> Allowed
Request 5  -> Allowed
Request 6  -> Rate Limited


Tenant Beta
-----------
Allowed Requests: 10
Window: 10 Seconds

Request 1  -> Allowed
Request 2  -> Allowed
...
Request 10 -> Allowed
Request 11 -> Rate Limited
```

When the configured limit is exceeded, the gateway responds with HTTP `429 Too Many Requests`.

---

### 4. Reverse Proxying

The gateway forwards authorized requests to their corresponding backend services.

Instead of implementing a separate routing mechanism for every client, the gateway uses a centralized route matrix.

```javascript
const ROUTE_MATRIX = {
    "/api/v1/auth": 5001,
    "/api/v1/telemetry": 5002
};
```

Incoming requests are matched against registered route prefixes.

| Route Prefix | Backend Service | Port |
|--------------|-----------------|------|
| `/api/v1/auth` | Authentication Service | 5001 |
| `/api/v1/telemetry` | Telemetry Service | 5002 |

The gateway forwards the original request method, path, and headers to the matched service.

Request bodies are streamed to the backend service rather than being manually reconstructed.

Backend responses are streamed back to the original client.

This allows the gateway to operate as a centralized reverse proxy.

---

###  5. Tenant Identity Propagation

After authenticating a request, the gateway injects the resolved tenant identity into the forwarded request headers.

```javascript
forwardedHeaders["x-forwarded-project-id"] = tenantId;
```

Example:

```http
POST /api/v1/telemetry HTTP/1.1
Host: localhost:8000
x-api-key: tenant_alpha_key
```

The internal service receives:

```http
POST /api/v1/telemetry HTTP/1.1
Host: localhost:5002
x-api-key: tenant_alpha_key
x-forwarded-project-id: project_alpha_ecommerce
```

The backend service can use this tenant identifier to associate incoming data with the correct project.

This establishes a foundation for tenant-aware data processing and storage.

---

###  6. Gateway-Level Error Handling

The gateway handles several request failure scenarios.

| Status Code | Meaning | Scenario |
|-------------|---------|----------|
| `401` | Unauthorized | Missing or invalid API key |
| `404` | Not Found | No registered route matches the request |
| `429` | Too Many Requests | Tenant exceeds its configured request quota |
| `502` | Bad Gateway | Internal backend service is unreachable |

For rate-limited requests, the gateway also returns a `Retry-After` header.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 10
```

This informs clients that they should wait before retrying.

---

##  Architecture & Request Lifecycle

Every request passes through a centralized processing pipeline.

### Step 1 — Incoming Request

The client sends a request to the gateway.

```http
GET http://localhost:8000/api/v1/telemetry
```

### Step 2 — Route Resolution

The gateway checks the incoming URL against the route matrix.

If no matching route exists, the request is rejected with `404 Not Found`.

### Step 3 — API Key Authentication

The gateway extracts the API key from the `x-api-key` header.

The key is validated against the project registry.

Invalid requests are rejected with `401 Unauthorized`.

### Step 4 — Tenant Identification

The gateway resolves the tenant's project ID and configured request quota.

```javascript
const tenantId = clientProfile.projectId;
const tenantLimit = clientProfile.allowedLimits;
```

### Step 5 — Rate Limit Enforcement

The gateway checks the tenant's request counter.

If the tenant has exceeded its configured quota, the request is rejected.

Otherwise, the request proceeds to the proxying stage.

### Step 6 — Tenant Context Injection

The gateway adds the resolved project ID to the forwarded headers.

```http
x-forwarded-project-id: project_alpha_ecommerce
```

### Step 7 — Request Forwarding

The gateway forwards the request to the corresponding internal microservice.

### Step 8 — Response Streaming

The backend service processes the request and returns its response.

The gateway streams the response back to the client.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime environment |
| Native HTTP Module | Gateway server and reverse proxy |
| Express.js | Dependency available in the project |
| Nodemon | Development workflow |
| JavaScript | Application logic |

The gateway's core HTTP server and proxying logic use Node.js native HTTP functionality.

---

##  Project Structure

```text
Custom-API-Gateway/
│
├── server.js
│   └── Main API Gateway
│
├── mock-service.js
│   └── Mock Telemetry Microservice
│
├── package.json
│   └── Project Dependencies
│
├── package-lock.json
│   └── Dependency Lockfile
│
└── README.md
    └── Project Documentation
```

### Core Components

**`server.js`**

Contains the API Gateway implementation, including:

- Route resolution
- API key validation
- Tenant identification
- Dynamic rate limiting
- Reverse proxying
- Tenant context propagation
- Gateway error handling

**`mock-service.js`**

Implements a lightweight telemetry microservice that listens on port `5002`.

It returns a JSON response when a request is successfully forwarded through the gateway.

---

## ⚙️ Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js 18+
- npm
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

Navigate into the project:

```bash
cd YOUR_REPOSITORY
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Gateway

```bash
node server.js
```

The gateway starts on:

```text
http://localhost:8000
```

### 4. Start the Telemetry Microservice

Open another terminal:

```bash
node mock-service.js
```

The telemetry service starts on:

```text
http://localhost:5002
```

> **Note:** The authentication service on port `5001` must also be running for requests targeting `/api/v1/auth`.

---

## 🧪 Testing the Gateway

You can test the gateway using Postman, Insomnia, or cURL.

### Test 1 — Valid API Key

```bash
curl -i http://localhost:8000/api/v1/telemetry \
  -H "x-api-key: sachin_secret_key_123"
```

Expected behavior:

- API key is validated.
- Tenant is identified.
- Rate limit is checked.
- Request is forwarded to the telemetry service.
- Backend response is returned to the client.

Example response:

```json
{
  "status": "Success!",
  "source": "Internal Telemetry Service running on PORT 5002",
  "message": "Data Successfully routed and processed through Sachin's Custom API Gateway!"
}
```

### Test 2 — Invalid API Key

```bash
curl -i http://localhost:8000/api/v1/telemetry \
  -H "x-api-key: invalid_key"
```

Expected:

```http
HTTP/1.1 401 Unauthorized
```

### Test 3 — Missing API Key

```bash
curl -i http://localhost:8000/api/v1/telemetry
```

Expected:

```http
HTTP/1.1 401 Unauthorized
```

### Test 4 — Unknown Route

```bash
curl -i http://localhost:8000/api/v1/unknown
```

Expected:

```http
HTTP/1.1 404 Not Found
```

### Test 5 — Rate Limit Enforcement

Send multiple requests using the same API key.

```bash
for i in {1..7}; do
  curl -i http://localhost:8000/api/v1/telemetry \
    -H "x-api-key: sachin_secret_key_123"
done
```

The configured quota for this tenant is five requests.

Once the quota is reached, the gateway returns:

```http
HTTP/1.1 429 Too Many Requests
```

**Note:** The current implementation stores request timestamps in memory and does not yet prune expired timestamps. Restarting the gateway resets the rate-limit state.

---

## 📈 Current Implementation

This project is an ongoing exploration of API Gateway architecture.

The current implementation demonstrates:

- [x] Centralized API Gateway
- [x] Route-based request forwarding
- [x] API key authentication
- [x] Multi-tenant project registry
- [x] Tenant-specific rate limits
- [x] Tenant identity propagation
- [x] HTTP request streaming
- [x] HTTP response streaming
- [x] Gateway-level error handling
- [x] Retry-After response header

---


##  Learning Objectives

This project explores several important backend and system design concepts:

- API Gateway architecture
- Reverse proxying
- Multi-tenant system design
- API key authentication
- Tenant isolation
- Rate limiting algorithms
- Request and response streaming
- HTTP protocol fundamentals
- Microservice communication
- Gateway-level traffic management

The goal is to understand how these components work internally rather than relying entirely on an existing API Gateway framework.

---

##  Limitations

This project is currently an educational prototype.

The current implementation has the following limitations:

- Rate-limit state is stored in process memory.
- Rate-limit timestamps are not automatically expired.
- Rate-limit state is lost when the gateway restarts.
- Rate limiting is not shared between multiple gateway instances.
- API keys are stored directly in the source code.
- The project registry is static.
- The gateway does not yet implement a distributed rate limiter.
- The current reverse proxy does not include a complete production-grade timeout, retry, or circuit-breaker strategy.

These limitations are intentional opportunities for further development and architectural improvement.

---

## 👨‍💻 Author

**Sachin Mehta**

Backend Developer | System Design Enthusiast

Exploring backend engineering, distributed systems, API infrastructure, and scalable application architecture.

GitHub: [@SachinsBuilds](https://github.com/SachinsBuilds)

---

## ⭐ Support

If you find this project interesting, consider giving it a star.

Feedback, suggestions, and contributions are welcome.

---

**Built from scratch to understand how API gateways work internally.**
