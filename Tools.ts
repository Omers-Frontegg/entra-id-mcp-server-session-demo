import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import "isomorphic-fetch";
import dotenv from "dotenv";
import { tokenStore } from "./auth/TokenStore.js";
import { WebClient } from "@slack/web-api";

dotenv.config();

type ToolInput = z.infer<typeof ToolSchema.shape.inputSchema>;

const ListSubscriptionsSchema = z.object({});
const ListSlackChannelsSchema = z.object({
  slackToken: z.string(),
  slackTeamId: z.string(),
});

enum ToolName {
  GET_USER_DETAILS = "getUserDetails",
  GET_SLACK_CHANNELS = "getSlackChannels",
}

interface GetSlacKChannelsRequest {
  tenantId: string;
}

const exampleTenantConfiguration = [
  {
    tenantId: "Bogdan",
    slackToken: "",
  },
  {
    tenantId: "Omer",
    slackToken: "",
  },
];

export const createServer = () => {
  const server = new Server(
    {
      name: "simple-mcp-server",
      version: "0.0.1",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {
          [ToolName.GET_SLACK_CHANNELS]: {
            description:
              "A tool that lists all the channels in the currently authenticated tenants's Slack workspace.",
          },
          [ToolName.GET_USER_DETAILS]: {
            description:
              "A tool that can provide details about the currently authenticated user.",
          },
        },
        logging: {},
      },
    }
  );

  let updateInterval: NodeJS.Timeout | undefined;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: ToolName.GET_USER_DETAILS,
        description:
          "A tool that can provide details about the currently authenticated user.",
        inputSchema: zodToJsonSchema(ListSubscriptionsSchema) as ToolInput,
      },
      {
        name: ToolName.GET_SLACK_CHANNELS,
        description:
          "A tool that lists all the channels in the currently authenticated tenants's Slack workspace.",
        inputSchema: zodToJsonSchema(ListSlackChannelsSchema) as ToolInput,
      },
    ];

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const context = request.params?.context as { token?: string } | undefined;
    const sessionToken = context?.token;

    if (name === ToolName.GET_SLACK_CHANNELS) {
      try {
        if (!request.params.arguments || !request.params.arguments.tenantId) {
          throw new Error("Tenant ID is required");
        }
        const args = request.params
          .arguments as unknown as GetSlacKChannelsRequest;

        const tenantId = args.tenantId;
        const slackToken = exampleTenantConfiguration.find(
          (config) => config.tenantId === tenantId
        )?.slackToken;
        if (!slackToken) {
          throw new Error("Slack token not found for tenant ID: " + tenantId);
        }
        const slackClient = new WebClient(slackToken);

        const channels = await slackClient.conversations.list({});

        if (!channels.channels) {
          throw new Error("No channels found");
        }
        const result = JSON.stringify(channels.channels);
        console.log(result);

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [
            { type: "text", text: `Error getting channels: ${errorMessage}` },
          ],
        };
      }
    }
    if (name === ToolName.GET_USER_DETAILS) {
      try {
        if (!sessionToken) {
          throw new Error("No authentication token provided");
        }

        const tokenData = tokenStore.getToken(sessionToken);
        if (!tokenData) {
          throw new Error("Invalid or expired session token");
        }

        return {
          content: [
            {
              type: "text",
              text: `User Details:
                Name: asdfasdf
                Email: asdfasdf
                UPN: asdfsdf`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [
            {
              type: "text",
              text: `Error getting user details: ${errorMessage}`,
            },
          ],
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const cleanup = async () => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
  };

  return { server, cleanup };
};
