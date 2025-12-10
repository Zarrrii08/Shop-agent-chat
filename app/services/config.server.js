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
    // Primary model (can be overridden via env ANTHROPIC_MODEL)
    defaultModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
    // Fallback if the primary model is not available in the account/region
    fallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || "claude-3-5-sonnet-latest",
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
