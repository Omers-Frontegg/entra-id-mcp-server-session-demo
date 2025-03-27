import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { NextFunction, Request, Response } from "express";
import { createServer } from "./Tools.js";
import getRawBody from "raw-body";

const app = express();

const { server, cleanup } = createServer();

let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("Received connection");
  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);

  server.onclose = async () => {
    await cleanup();
    await server.close();
    process.exit(0);
  };
});

app.post("/message", async (req, res) => {
  console.log("Received message");

  const rawBody = await getRawBody(req, {
    limit: "1mb",
    encoding: "utf-8",
  });

  const messageBody = JSON.parse(rawBody.toString());
  if (!messageBody.params) {
    messageBody.params = {};
  }

  await transport.handlePostMessage(req, res, messageBody);
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
