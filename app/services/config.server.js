/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */
import dotenv from "dotenv";

// Load environment variables from .env for both local and server runtimes
dotenv.config();

export const AppConfig = {
  // API Configuration
  api: {
    // Updated to the stable Claude Sonnet release requested
    defaultModel: "claude-3-5-sonnet-20241022",
    maxTokens: 2000,
    defaultPromptType: "standardAssistant",
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported:
      "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Claude API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    genericError: "Failed to get response from Claude",
  },

  // Tool Configuration
  tools: {
    productSearchName: "search_shop_catalog",
    maxProductsToDisplay: 3,
  },
};

export default AppConfig;
