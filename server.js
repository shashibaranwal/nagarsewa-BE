import dotenv from "dotenv";
dotenv.config();

import os from "os";
import connectDB from "./src/config/db.js";
import app from "./src/app.js";
import { startAutomationScheduler, startScoreScheduler } from "./src/jobs/scheduler.js";

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  startAutomationScheduler();
  startScoreScheduler();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Server is up and running!`);
    console.log(`\n  ➜  Local:   http://localhost:${PORT}`);
    
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`  ➜  Network: http://${iface.address}:${PORT}`);
        }
      }
    }
    console.log();
  });
});


if (process.env.ENABLE_NGROK === "true") {
  const { default: ngrok } = await import("@ngrok/ngrok");
  const forwarder = await ngrok.forward({
    addr: `localhost:${PORT}`,
    authtoken_from_env: true,
    ...(process.env.NGROK_DOMAIN && { domain: process.env.NGROK_DOMAIN }),
  });
  console.log(`Available at: ${forwarder.url()}`);
}