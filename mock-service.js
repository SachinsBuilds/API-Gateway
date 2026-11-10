const http = require('http');

http.createServer((req, res) => {
    console.log(`[Microservice 5002] Recieved Forwarded request at: ${req.url}`);

    res.writeHead(200, { 'Content-type': "application/json" });
    res.end(JSON.stringify({ status: "Success!", source: "Internal Telemetry Service running on PORT 5002", message: "Data Successfully routed and processed through Sachin's Custom API Gateway!" }));

}).listen(5002, () => console.log("🤖 Mock Telemetry Live on Port 5002"));