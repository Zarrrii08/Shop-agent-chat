/**
 * Authentication service for handling OAuth and PKCE flows
 */

/**
 * Generate authorization URL for the customer
 * @param {string} conversationId - The conversation ID to track the auth flow
 * @returns {Promise<Object>} - Object containing the auth URL and conversation ID
 */
export async function generateAuthUrl(conversationId, shopId) {
  const { storeCodeVerifier } = await import('./db.server');

  // Generate authorization URL for the customer
  const clientId = process.env.SHOPIFY_API_KEY;
  const scope = "customer-account-mcp-api:full";
  const responseType = "code";

  // Use the actual app URL for redirect
  const redirectUri = 'https://shopify-agent-003f.webgeeksolutions.com.au/api/auth/callback';
  console.log('[generateAuthUrl] START - Redirect URI:', redirectUri);
  console.log('[generateAuthUrl] START - Client ID:', clientId);
  console.log('[generateAuthUrl] START - Scope:', scope);
  console.log('[generateAuthUrl] START - redirectUri type:', typeof redirectUri, 'value:', redirectUri);

  // Include the conversation ID and shop ID in the state parameter for tracking
  const state = `${conversationId}-${shopId}`;

  // Generate code verifier and challenge
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // Store the code verifier in the database
  try {
    await storeCodeVerifier(state, verifier);
  } catch (error) {
    console.error('Failed to store code verifier:', error);
  }

  // Set code_challenge and code_challenge_method parameters
  const codeChallengeMethod = "S256";
  let baseAuthUrl = await getBaseAuthUrl(conversationId);
  console.log('[generateAuthUrl] Base Auth URL retrieved:', baseAuthUrl);
  console.log('[generateAuthUrl] Base Auth URL type:', typeof baseAuthUrl);

  if (!baseAuthUrl) {
    baseAuthUrl = 'https://accounts.shopify.com/oauth/authorize';
    console.warn('[generateAuthUrl] No base auth URL found, falling back to default:', baseAuthUrl);
  }

  // If the returned base URL contains template placeholders like {redirect_uri}, replace them
  let authUrl;
  try {
    console.log('[generateAuthUrl] Processing base URL, checking for placeholders');
    
    if (baseAuthUrl.includes('{redirect_uri}')) {
      console.log('[generateAuthUrl] Found {redirect_uri} placeholder, replacing');
      baseAuthUrl = baseAuthUrl.replace(/\{redirect_uri\}/g, encodeURIComponent(redirectUri));
    }

    if (baseAuthUrl.includes('{client_id}')) {
      console.log('[generateAuthUrl] Found {client_id} placeholder, replacing');
      baseAuthUrl = baseAuthUrl.replace(/\{client_id\}/g, clientId || '');
    }

    // Build the final URL using the URL API to avoid manual string concatenation issues
    console.log('[generateAuthUrl] Creating URL object from base:', baseAuthUrl);
    const urlObj = new URL(baseAuthUrl);
    console.log('[generateAuthUrl] URL object created successfully');
    
    // Ensure we don't leave an empty redirect_uri param from the base
    if (urlObj.searchParams.has('redirect_uri')) {
      console.log('[generateAuthUrl] Removing existing redirect_uri param from base');
      urlObj.searchParams.delete('redirect_uri');
    }

    console.log('[generateAuthUrl] Setting searchParams - clientId:', clientId);
    console.log('[generateAuthUrl] Setting searchParams - redirectUri:', redirectUri);
    console.log('[generateAuthUrl] redirectUri type:', typeof redirectUri);
    console.log('[generateAuthUrl] redirectUri length:', redirectUri ? redirectUri.length : 'null/undefined');
    console.log('[generateAuthUrl] urlObj before setting params:', urlObj.toString());
    console.log('[generateAuthUrl] urlObj.searchParams before:', urlObj.searchParams.toString());
    
    urlObj.searchParams.set('client_id', clientId || '');
    urlObj.searchParams.set('scope', scope);
    urlObj.searchParams.set('redirect_uri', redirectUri);
    urlObj.searchParams.set('response_type', responseType);
    urlObj.searchParams.set('state', state);
    urlObj.searchParams.set('code_challenge', challenge);
    urlObj.searchParams.set('code_challenge_method', codeChallengeMethod);

    console.log('[generateAuthUrl] urlObj after setting params:', urlObj.toString());
    console.log('[generateAuthUrl] urlObj.searchParams after:', urlObj.searchParams.toString());
    console.log('[generateAuthUrl] redirect_uri param value:', urlObj.searchParams.get('redirect_uri'));

    authUrl = urlObj.toString();
    console.log('[generateAuthUrl] Final URL built successfully');
  } catch (err) {
    // Fallback to original construction if URL parsing fails for unexpected endpoint formats
    console.warn('[generateAuthUrl] Failed to parse baseAuthUrl with URL API, falling back to string concatenation:', err?.message || err);
    authUrl = `${baseAuthUrl}?client_id=${clientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=${responseType}&state=${state}&code_challenge=${challenge}&code_challenge_method=${codeChallengeMethod}`;
    console.log('[generateAuthUrl] Fallback Full Auth URL:', authUrl);
  }
  
  console.log('[generateAuthUrl] Final Auth URL:', authUrl);
  console.log('[generateAuthUrl] Final Auth URL includes redirect_uri:', authUrl.includes('redirect_uri='));
  console.log('[generateAuthUrl] Final redirect_uri param value:', new URL(authUrl).searchParams.get('redirect_uri'));
  
  // Also log what will be sent to client
  const returnValue = {
    url: authUrl,
    conversation_id: conversationId
  };
  console.log('[generateAuthUrl] Returning to client:', JSON.stringify(returnValue, null, 2));

  return returnValue;
}

/**
 * Get the base auth URL from the customer MCP API URL
 * @param {string} conversationId - The conversation ID to track the auth flow
 * @returns {Promise<string|null>} - The base auth URL or null if not found
 */
async function getBaseAuthUrl(conversationId) {
  const { getCustomerAccountUrls } = await import('./db.server');
  const urls = await getCustomerAccountUrls(conversationId);

  console.log('[getBaseAuthUrl] Retrieved URLs from DB:', JSON.stringify(urls, null, 2));
  console.log('[getBaseAuthUrl] authorizationUrl:', urls?.authorizationUrl);
  console.log('[getBaseAuthUrl] authorizationUrl type:', typeof urls?.authorizationUrl);
  console.log('[getBaseAuthUrl] authorizationUrl length:', urls?.authorizationUrl ? urls.authorizationUrl.length : 'null/undefined');

  // Return stored URL or default to Shopify accounts
  const result = urls?.authorizationUrl || 'https://accounts.shopify.com/oauth/authorize';
  console.log('[getBaseAuthUrl] Returning:', result);
  console.log('[getBaseAuthUrl] Result type:', typeof result);
  return result;
}

/**
 * Generate a code verifier for PKCE
 * @returns {string} - The generated code verifier
 */
export function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const randomString = convertBufferToString(array);
  return base64UrlEncode(randomString);
}

/**
 * Generate a code challenge from a verifier
 * @param {string} verifier - The code verifier
 * @returns {Promise<string>} - The generated code challenge
 */
export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digestOp = await crypto.subtle.digest('SHA-256', data);
  const hash = convertBufferToString(digestOp);
  return base64UrlEncode(hash);
}

/**
 * Convert a buffer to a string
 * @param {ArrayBuffer} buffer - The buffer to convert
 * @returns {string} - The converted string
 */
function convertBufferToString(buffer) {
  const uintArray = new Uint8Array(buffer);
  const numberArray = Array.from(uintArray);
  return String.fromCharCode.apply(null, numberArray);
}

/**
 * Encode a string in base64url format
 * @param {string} str - The string to encode
 * @returns {string} - The encoded string
 */
function base64UrlEncode(str) {
  // Convert string to base64
  let base64 = btoa(str);

  // Make base64 URL-safe by replacing characters
  base64 = base64.replace(/\+/g, "-")
                 .replace(/\//g, "_")
                 .replace(/=+$/, ""); // Remove any trailing '=' padding

  return base64;
}
