# Custom API Gateway

A multi-tenant API Gateway built from scratch with Node.js and the native HTTP module.

This project demonstrates how a gateway can authenticate incoming requests, resolve tenant identity, apply tenant-specific rate limits, route traffic to internal services, stream request and response bodies, and return clear gateway-level errors.

> **Project status:** Backend prototype. It is designed to demonstrate API Gateway fundamentals and is not intended to be deployed as a production gateway without additional security, observability, and distributed-systems work.

## Overview

In a microservices architecture, clients should not need to communicate directly with every internal service. An API Gateway can provide a single entry point for:

- Request routing

- API-key authentication

- Tenant identification

- Per-tenant rate limiting

- Request and response streaming

- Internal service communication

- Upstream failure handling

This project implements those responsibilities using Node.js's built-in `http` module instead of an API Gateway framework.

## Architecture

```
                              Client Request
                                    |
                                    v
                         +----------------------+
                         |   API Gateway        |
                         |   localhost:8000     |
                         +----------+-----------+
                                    |
                +-------------------+-------------------+
                |                   |                   |
                v                   v                   v
        Route Resolution     API-Key Validation   Tenant Resolution
                                                        |
                                                        v
                                             Per-Tenant Rate Limiting
                                                        |
                                                        v
                                             Tenant Header Injection
                                                        |
                                                        v
                                              Reverse Proxy Streaming
                                                        |
                         +------------------+-----------+------------------+
                         |                  |                              |
                         v                  v                              v
                Auth Service         Telemetry Service              Other Services
                localhost:5001       localhost:5002                  Future routes
```

## Request Lifecycle

Each request follows this flow:

1. The client sends a request to the gateway on port `8000`.

1. The gateway matches the request path against the configured route matrix.

1. The gateway reads the `x-api-key` header.

1. The API key is resolved through the in-memory project registry.

1. The gateway identifies the tenant and its configured request quota.

1. The tenant's request timestamps are checked against the ten-second rate-limit window.

1. The gateway adds `x-forwarded-project-id` to the forwarded request headers.

1. The request is streamed to the selected internal service.

1. The internal response is streamed back to the original client.

1. Invalid requests and upstream failures receive an appropriate HTTP error response.

## Core Features

### Route-based reverse proxying

The gateway uses a route matrix to map public paths to internal service ports:

```
const ROUTE_MATRIX = {
  "/api/v1/auth": 5001,
  "/api/v1/telemetry": 5002,
};
```

A request such as:

```
GET /api/v1/telemetry
```

is forwarded to the service running on port `5002`.

### API-key authentication

Requests must provide a registered API key through the `x-api-key` header. Requests with missing or unknown keys are rejected before they reach an internal service.

Example:

```
x-api-key: demo_secret_key_123
```

The current demonstration registry contains two tenants:

| API key | Project ID | Limit |
| --- | --- | --- |
| `demo_secret_key_123` | `project_alpha_ecommerce` | 5 requests per 10 seconds |
| `revenue_guard_prod_token` | `project_beta_dashboard` | 10 requests per 10 seconds |

These values are demonstration credentials stored in source code. They must be replaced with secure secret management before any real deployment.

### Tenant identity propagation

After authentication, the gateway resolves the project identity from the API key and adds it to the forwarded request:

```
x-forwarded-project-id: project_alpha_ecommerce
```

The internal service can use this trusted gateway-generated header to associate the request with the correct tenant.

### Per-tenant rate limiting

Each tenant has a separate in-memory rate-limit bucket. One tenant's traffic does not consume another tenant's quota.

The current implementation uses a ten-second sliding-window approach:

```
Tenant Alpha: 5 requests per 10 seconds
Tenant Beta: 10 requests per 10 seconds
```

Expired timestamps are removed from the active window before the next request is evaluated. When a tenant exceeds its quota, the gateway returns `429 Too Many Requests` and includes a `Retry-After` response header.

### Streaming proxy behavior

The gateway forwards request bodies with native Node.js streams instead of collecting the full body in memory:

```
req.pipe(proxyreq);
```

Responses from internal services are streamed back to the client:

```
proxyRes.pipe(res);
```

This demonstrates the basic mechanics of non-blocking request and response forwarding.

### Upstream error handling

If an internal service is unavailable or does not respond within the configured timeout, the gateway returns `502 Bad Gateway` when the response has not already started.

The current upstream timeout is five seconds.

## HTTP Responses

| Status | Meaning | Example condition |
| --- | --- | --- |
| `200` | Success | Internal service processes the request |
| `401` | Unauthorized | Missing or unregistered API key |
| `404` | Not Found | No configured route matches the request |
| `429` | Too Many Requests | Tenant exceeds its configured quota |
| `502` | Bad Gateway | Internal service is unavailable or times out |

## Project Structure

```
API-Gateway/
├── server.js
│   └── Main API Gateway server
├── mock-service.js
│   └── Example telemetry service on port 5002
├── package.json
│   └── Project metadata and local commands
├── package-lock.json
│   └── Locked dependency versions
└── README.md
    └── Project documentation
```

## Requirements

- Node.js 18 or newer

- npm

- Git

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/SachinsBuilds/API-Gateway.git
cd API-Gateway
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the gateway

```bash
npm start
```

The gateway listens on:

```
http://localhost:8000
```

### 4. Start the mock telemetry service

Open a second terminal in the project directory and run:

```bash
npm run start:mock
```

The mock telemetry service listens on:

```
http://localhost:5002
```

The `/api/v1/auth` route is included in the route matrix, but an authentication service is not included in this repository. Requests to that route require a separate service running on port `5001`.

## Manual Verification with cURL

The following commands demonstrate the gateway behavior.

### Successful forwarding

```bash
curl -i http://localhost:8000/api/v1/telemetry \
  -H "x-api-key: demo_secret_key_123"
```

Expected result: the request is authenticated, assigned to `project_alpha_ecommerce`, and forwarded to the mock telemetry service.

Example response:

```json
{
  "status": "Success!",
  "source": "Internal Telemetry Service running on PORT 5002",
  "message": "Data Successfully routed and processed through Sachin's Custom API Gateway!"
}
```

### Invalid API key

```bash
curl -i http://localhost:8000/api/v1/telemetry \
  -H "x-api-key: invalid_key"
```

Expected result:

```
HTTP/1.1 401 Unauthorized
```

### Missing API key

```bash
curl -i http://localhost:8000/api/v1/telemetry
```

Expected result:

```
HTTP/1.1 401 Unauthorized
```

### Unknown route

```bash
curl -i http://localhost:8000/api/v1/unknown \
  -H "x-api-key: demo_secret_key_123"
```

Expected result:

```
HTTP/1.1 404 Not Found
```

### Rate-limit behavior

The alpha tenant is configured for five requests per ten seconds. The sixth request within the active window should return `429`:

```bash
for i in {1..6}; do
  curl -i http://localhost:8000/api/v1/telemetry \
    -H "x-api-key: demo_secret_key_123"
done
```

After the active ten-second window expires, requests can be accepted again.

### Upstream failure behavior

Stop the mock telemetry service while the gateway is still running, then send:

```bash
curl -i http://localhost:8000/api/v1/telemetry \
  -H "x-api-key: demo_secret_key_123"
```

Expected result:

```
HTTP/1.1 502 Bad Gateway
```

## Available Commands

```bash
npm start
```

Starts the gateway with Node.js.

```bash
npm run dev
```

Starts the gateway with Nodemon for local development.

```bash
npm run start:mock
```

Starts the mock telemetry service with Nodemon.

## Engineering Decisions

### Why native Node.js HTTP APIs?

The gateway uses the native `http` module to make request forwarding, headers, streams, and upstream errors visible. This keeps the implementation small and makes the behavior easier to study than using a full gateway framework.

### Why rate-limit by tenant?

A global request counter would allow one customer to consume capacity intended for another customer. The project registry maps each API key to a project identity and an individual quota, so rate-limit state is maintained per tenant.

### Why inject tenant identity at the gateway?

The gateway is the component that authenticates the API key. It can therefore resolve the tenant once and pass trusted tenant context to internal services instead of requiring every service to repeat the same lookup.

### Why stream request bodies?

Streaming avoids manually buffering the entire request body in the gateway before forwarding it. This is a useful foundation for handling larger requests more efficiently, although production deployments still need body-size limits and additional safeguards.

## Author

**Sachin Mehta**

Backend Engineer focused on TypeScript, Node.js, APIs, infrastructure, and multi-tenant systems.

- GitHub: [@SachinsBuilds](https://github.com/SachinsBuilds)

- Repository: [Custom API Gateway](https://github.com/SachinsBuilds/API-Gateway)

services, and handled when upstream services fail.

