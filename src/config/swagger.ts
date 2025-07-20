import swaggerJSDoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Theme Deployment API",
      version: "1.0.0",
      description:
        "API for automating deployment of e-commerce themes to Ubuntu VPS.",
    },
    servers: [{ url: "http://localhost:4444" }],
    components: {
      schemas: {
        Business: {
          type: "object",
          properties: {
            businessId: { type: "string", example: "1" },
            userId: { type: "string", example: "1" },
            gtmId: { type: "string", example: "dsfs" },
            domain: { type: "string", example: "dsfsd.com" },
          },
          required: ["businessId", "userId", "gtmId", "domain"],
          example: {
            themeId: "1",
            businessId: "682b5d636be45193cf943b85",
            userId: "6829ddabc20c6404b3e2a66b",
            gtmId: "GTM-5NR79L8B",
            domain: "emegadeal.com",
          },
        },
        Deployment: {
          type: "object",
          properties: {
            themeId: { type: "string", example: "ecom-001" },
            businessId: { type: "string", example: "1" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "success", "failed"],
              example: "success",
            },
            logs: {
              type: "array",
              items: { type: "string" },
              example: ["Cloned repo", "Built project"],
            },
          },
          required: ["themeId", "businessId", "status"],
        },
      },
      requestBodies: {
        DeployTheme: {
          description: "Business and theme info",
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  themeId: { type: "string", example: "ecom-001" },
                  businessId: { type: "string", example: "1" },
                  userId: { type: "string", example: "1" },
                  gtmId: { type: "string", example: "dsfs" },
                  domain: { type: "string", example: "dsfsd.com" },
                },
                required: [
                  "themeId",
                  "businessId",
                  "userId",
                  "gtmId",
                  "domain",
                ],
              },
            },
          },
        },
      },
      responses: {
        DeploymentResult: {
          description: "Deployment result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  deployment: { $ref: "#/components/schemas/Deployment" },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
};

const swaggerSpec = swaggerJSDoc(options);
export default swaggerSpec;
