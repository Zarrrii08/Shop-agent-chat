/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 */
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrls, getCustomerAccountUrls as getCustomerAccountUrlsFromDb, getCustomerToken } from "../db.server";
import { generateAuthUrl } from "../auth.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";


/**
 * Rract Router loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && (request.headers.get("Accept") || "").includes("text/event-stream")) {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return new Response(JSON.stringify({ error: AppConfig.errorMessages.apiUnsupported }), { status: 400, headers: getCorsHeaders(request) });
}

/**
 * React Router action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const messages = await getConversationHistory(conversationId);

  return new Response(JSON.stringify({ messages }), { headers: getCorsHeaders(request) });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    const wantsSse = (request.headers.get("Accept") || "").includes("text/event-stream");
    const body = await safeReadJson(request);
    const rawMessage = body?.message ?? "";
    const userMessage = typeof rawMessage === "string" ? rawMessage.trim() : "";

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: wantsSse ? getSseHeaders(request) : getCorsHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId =
      (typeof body.conversation_id === "string" && body.conversation_id.trim()) ||
      Date.now().toString();
    const promptType =
      (typeof body.prompt_type === "string" && body.prompt_type) || AppConfig.api.defaultPromptType;

    if (wantsSse) {
      // Create a stream for the response
      const responseStream = createSseStream(async (stream) => {
        await handleChatSession({
          request,
          userMessage,
          conversationId,
          promptType,
          stream
        });
      });

      return new Response(responseStream, {
        headers: getSseHeaders(request)
      });
    }

    // JSON fallback (non-SSE clients)
    const bufferedStream = createBufferedStream();
    await handleChatSession({
      request,
      userMessage,
      conversationId,
      promptType,
      stream: bufferedStream
    });

    const result = bufferedStream.getResult();

    return new Response(
      JSON.stringify({
        conversation_id: conversationId,
        message: result.text,
        products: result.products,
        events: result.events
      }),
      {
        headers: getCorsHeaders(request)
      }
    );
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Detect if a user message requests account-level data
 * @param {string} message - The user's message
 * @returns {boolean} - True if account data is requested
 */
function isAccountDataRequest(message) {
  const accountKeywords = [
    'my account', 'my orders', 'my order', 'order history', 'order status',
    'tracking', 'track my order', 'my purchases', 'my profile', 'account info',
    'customer info', 'my details', 'my information', 'login', 'sign in'
  ];

  const lowerMessage = message.toLowerCase();
  return accountKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Check if customer is authenticated for account data access
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<boolean>} - True if authenticated
 */
async function isCustomerAuthenticated(conversationId) {
  const token = await getCustomerToken(conversationId);
  return token && token.accessToken;
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  stream
}) {
  // Phase 2: Detect account-level data requests and ensure authentication
  if (isAccountDataRequest(userMessage)) {
    const isAuthenticated = await isCustomerAuthenticated(conversationId);
    if (!isAuthenticated) {
      // Generate auth URL and prompt user to authorize
      const shopId = request.headers.get("X-Shopify-Shop-Id");
      const authResponse = await generateAuthUrl(conversationId, shopId);

      // Save the user message for later processing
      await saveMessage(conversationId, 'user', userMessage);

      // Send auth prompt to client as a regular message
      const authMessage = `To access your account information, orders, and order tracking, I need you to authorize access to your customer data. [Click here to authorize](${authResponse.url})`;
      
      // Save the auth message
      await saveMessage(conversationId, 'assistant', authMessage);
      
      // Send the message to client
      stream.sendMessage({ type: 'id', conversation_id: conversationId });
      stream.sendMessage({
        type: 'chunk',
        chunk: authMessage
      });
      stream.sendMessage({ type: 'message_complete' });
      stream.sendMessage({ type: 'done' });
      return;
    }
  }

  // Initialize services
  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin") || "";
  const customerAccountUrls = await getCustomerAccountUrls(shopDomain, conversationId);
    const mcpApiUrl = customerAccountUrls?.mcpApiUrl;

  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    mcpApiUrl,
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();

      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    // Prepare conversation state
    let conversationHistory = [];
    let productsToDisplay = [];

    // Save user message to the database
    await saveMessage(conversationId, 'user', userMessage);

    // Fetch all messages from the database for this conversation
    const dbMessages = await getConversationHistory(conversationId);

    // Format messages for Claude API ensuring Anthropic content block shape
    conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
      } catch (e) {
        content = dbMessage.content;
      }

      const role = dbMessage.role === "assistant" ? "assistant" : "user";

      return {
        role,
        content: normalizeContent(content)
      };
    });

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: normalizeContent(userMessage) };
    let safetyCounter = 0;
    const maxTurns = 6;

    while (finalMessage.stop_reason !== "end_turn" && safetyCounter < maxTurns) {
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });

            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // Call the tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle tool response based on success/error
            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
      safetyCounter += 1;

      // Break early if the API did not provide a stop reason to avoid infinite loops
      if (!finalMessage || !finalMessage.stop_reason) {
        break;
      }
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    // Send product results if available
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });
    }
  } catch (error) {
    // The streaming handler takes care of error handling
    throw error;
  }
}

/**
 * Get the customer MCP API URL for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP API URL
 */
async function getCustomerAccountUrls(shopDomain, conversationId) {
  try {
    if (!shopDomain) {
      console.warn("No shop domain provided, skipping customer MCP URL lookup");
      return null;
    }

    // Check if the customer account URL exists in the DB
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);

    // If URL exists, return early with the MCP API URL
    if (existingUrls) return existingUrls;

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);

    const urls = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(res => res.json()),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(res => res.json()),
    ]).then(async ([mcpResponse, openidResponse]) => {
      const response = {
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      };

      await storeCustomerAccountUrls({
        conversationId,
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      });

      return response;
    });

    return urls;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return null;
  }
}

/**
 * Safely read JSON from a request without throwing on empty or invalid bodies
 */
async function safeReadJson(request) {
  try {
    return await request.json();
  } catch (error) {
    // GET requests for SSE won't have a body; log other failures for debugging
    if (request.method !== "GET") {
      console.warn("Failed to parse JSON body:", error?.message || error);
    }
    return {};
  }
}

/**
 * Create a lightweight stream manager that buffers events for non-SSE callers
 */
function createBufferedStream() {
  const events = [];
  const textChunks = [];
  const resultState = { products: [] };

  return {
    sendMessage(payload) {
      events.push(payload);

      if (payload?.type === "chunk" && typeof payload.chunk === "string") {
        textChunks.push(payload.chunk);
      }

      if (payload?.type === "product_results" && Array.isArray(payload.products)) {
        resultState.products = payload.products;
      }
    },
    closeStream() {},
    handleStreamingError(error) {
      events.push({
        type: "error",
        error: error?.message || AppConfig.errorMessages.genericError
      });
    },
    getResult() {
      return {
        text: textChunks.join(""),
        events,
        products: resultState.products
      };
    }
  };
}

/**
 * Normalize message content into Anthropic content block format
 * Accepts string, array of blocks, or already-structured content
 */
function normalizeContent(content) {
  // If already an array of blocks, return as-is
  if (Array.isArray(content)) {
    return content;
  }

  // If it's an object with type/text etc., wrap into array
  if (content && typeof content === "object" && content.type) {
    return [content];
  }

  // Fallback: treat as text
  const text = typeof content === "string" ? content : JSON.stringify(content || "");
  return [{
    type: "text",
    text
  }];
}
/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}
