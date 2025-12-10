/**
 * Streaming Service
 * Provides utilities for handling server-sent events (SSE) streams
 */

/**
 * Creates a StreamManager to handle SSE streams with proper backpressure
 * @param {TextEncoder} encoder - A TextEncoder instance
 * @param {ReadableStreamDefaultController} controller - The stream controller
 * @returns {Object} StreamManager with utility methods for handling streaming
 */
export function createStreamManager(encoder, controller) {
  /**
   * Send a data message to the client
   * @param {Object} data - Data to send
   */
  const sendMessage = (data) => {
    try {
      const text = `data: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(text));
    } catch (error) {
      console.error('Error sending stream message:', error);
    }
  };

  /**
   * Send an error message to the client
   * @param {Object} error - Error object
   * @param {string} error.type - Error type
   * @param {string} error.error - Error title/message
   * @param {string} error.details - Error details
   */
  const sendError = ({ type, error, details }) => {
    sendMessage({ type, error, details });
  };

  /**
   * Close the stream
   */
  const closeStream = () => {
    try {
      controller.close();
    } catch (error) {
      console.error('Error closing stream:', error);
    }
  };

  /**
   * Handle streaming errors by sending appropriate error messages
   * @param {Error} error - The error that occurred
   */
  const handleStreamingError = (error) => {
    console.error('Error processing streaming request:', error);

    const status = error?.status;
    const message = typeof error?.message === 'string' ? error.message : '';

    if (status === 401 || message.toLowerCase().includes('auth') || message.toLowerCase().includes('key')) {
      sendError({
        type: 'error',
        error: 'Authentication failed with Claude API',
        details: 'Please check your API key in environment variables'
      });
    } else if (status === 429 || status === 529 || message.includes('Overloaded')) {
      sendError({
        type: 'rate_limit_exceeded',
        error: 'Rate limit exceeded',
        details: 'Please try again later'
      });
    } else {
      sendError({
        type: 'error',
        error: 'Failed to get response from Claude',
        details: message || 'Unknown error'
      });
    }
  };

  return {
    sendMessage,
    sendError,
    closeStream,
    handleStreamingError
  };
}

/**
 * Creates a ReadableStream for SSE
 * @param {Function} streamHandler - Async function that handles the stream
 * @returns {ReadableStream} A readable stream for SSE
 */
export function createSseStream(streamHandler) {
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      const streamManager = createStreamManager(encoder, controller);
      
      try {
        await streamHandler(streamManager);
      } catch (error) {
        streamManager.handleStreamingError(error);
      } finally {
        streamManager.closeStream();
      }
    }
  });
}

export default {
  createSseStream,
  createStreamManager
};