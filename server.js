const { time } = require('console');
const http = require('http');

const ROUTE_MATRIX = {
    "/api/v1/auth": 5001,
    "/api/v1/telemetry": 5002
}

//Secure token registry
// const ALLOWED_API_KEYS = [
//     'sachin_secret_key_123',
//     'revenue_guard_prod_token'
// ]


const PROJECT_REGISTRY = {
    'demo_secret_key_123': {
        projectId: 'project_alpha_ecommerce',
        allowedLimits: 5
    },
    'revenue_guard_prod_token': {
        projectId: 'project_beta_dashboard',
        allowedLimits: 10   // Client B paid for higher capacity!
    }

}

const RateLimitCache = {};
const WINDOW_MS = 10000;
// const MAX_REQUEST = 5;

const PORT = 8000;

const gatewayServer = http.createServer((req, res) => {
    const incomingPath = req.url || '';
    const method = req.method;

    console.log(`[Gateway] Inbound Request: ${method} ${incomingPath}`);

    let targetPort;

    for (const prefix in ROUTE_MATRIX) {
        const matchesRoute = incomingPath === prefix || incomingPath.startsWith(`${prefix}`);
        if (matchesRoute) {
            targetPort = ROUTE_MATRIX[prefix];
            break;
        }
    }

    if (targetPort) {

        //The Edge Token Validations
        const incomingAPIKeys = req.headers['x-api-key'];
        //Check if incoming key exists inside our allowed array
        // const isAuthorized = incomingAPIKeys === "string" && ALLOWED_API_KEYS.includes(req.headers['x-api-key']);


        //Phase 5 
        //Getting Profile Data
        const clientProfile = PROJECT_REGISTRY[incomingAPIKeys];

        if (!clientProfile) {
            console.log(`[Gateway Security] 🛑 BLOCKED: Unregistered API key footprint on "${incomingPath}".`);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                error: "401 Unauthorized",
                message: "Invalid or missing 'x-api-key' footprint at gateway boundary."
            }));
        }


        const tenantId = clientProfile.projectId;
        const tenantLimit = clientProfile.allowedLimits;





        //Authorized Access key verified Successfully
        console.log(`[Gateway Security] Access Granted Key Verified`);

        //Phase 4 in-Memory Rate Limiter Pipeline

        const now = Date.now();
        const WINDOWStart = now - WINDOW_MS;

        const timestamps = RateLimitCache[tenantId] || [];

        const activeTimeStamps = timestamps.filter((timestamps) => timestamps > WINDOWStart)
        //Initialize with tenant id
        if (!RateLimitCache[tenantId]) {
            RateLimitCache[tenantId] = [];
        }

        if(activeTimeStamps.length >= tenantLimit){
            const retryafterSeconds = Math.max(1,Math.ceil((activeTimeStamps[0] + WINDOW_MS - now) / 1000))
            
            res.writeHead(429,{"Content-type":"application/json","Retry-after":String(retryafterSeconds)})
            return res.end(JSON.stringify({error:"Too Many Requests",message:`Rate Limit Exceeds ${tenantId}`}))
        }
    

        activeTimeStamps.push(now);
        RateLimitCache[tenantId] = activeTimeStamps;
        


        // //Next Proxying Phase 2 & Phase 5 Upgraded with tenants

        console.log(`[Gateay] Proxying: ${incomingPath} to Internal port: ${targetPort}`);
        //Configure the outbound network options to talk to our service


        //Clone incoming headers 
        const forwardedHeaders = { ...req.headers };


        //Stamp data downstream : inject the clean project footprint
        //so our internal databases know exactly where where to write incoming data correctly

        forwardedHeaders['x-forwarded-project-id'] = tenantId;


        const proxyOptions = {
            hostname: 'localhost',  // The internal service location (localhost)
            port: targetPort,   // The matched service port (5001 or 5002)
            path: incomingPath,   //Keep the same url endpoint path intact
            method: method,   //Forward GET, POST, PUT, DELETE, etc.
            headers: forwardedHeaders   // Use the new tenant-stamped header package

        }

        //Initialize the brand new internal http request
        const proxyreq = http.request(proxyOptions, (proxyRes) => {
            proxyreq.setTimeout(5000,() => {
                proxyreq.destroy(new Error("Upstream timeout"))
            })
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

            console.log(`[Gateway] streaming response back to the client.`);
            proxyRes.pipe(res);
        })

        //Gracefully handle network errors if the microservice is dead
        proxyreq.on("error", (err) => {
            if(res.headersSent){
                res.destroy();
                return
            }
            console.error(`[Gateway Error] Sub-service on port ${targetPort} is unreachable`);

            res.writeHead(502, { 'Content-type': 'application/json' });
            res.end(JSON.stringify({ error: "502 Bad Gateway", message: "The Backend microservice is currently offline or unreaachable" }))
        })


        req.pipe(proxyreq);


    } else {
        console.log(`[Gateway] Error: No route match found for ${incomingPath}`);
        res.writeHead(404, { 'Content-type': 'application/json' });
        res.end(JSON.stringify({ error: "404 not found", message: "Route Prefix not registered in gateway matrix" }))
    }
})


gatewayServer.listen(PORT, () => {
    console.log(` -> API Gateway running at ${PORT}`);
    console.log(`Registered Routes: `, ROUTE_MATRIX);
})