import "server-only";

export type SsoConfig = {
  authBaseUrl: URL;
  businessAppBaseUrl: URL;
  businessAppCallbackUrl: URL;
};

function parseBaseUrl(name: string, value: string | undefined): URL {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment.`);
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }

  return url;
}

/**
 * Read and validate server-only SSO URLs. Do not prefix these variables with NEXT_PUBLIC_.
 * Callback URLs are allowlisted by exact configured URL rather than accepted from request input.
 */
export function getSsoConfig(): SsoConfig {
  const authBaseUrl = parseBaseUrl("AUTH_BASE_URL", process.env.AUTH_BASE_URL);
  const businessAppBaseUrl = parseBaseUrl(
    "BUSINESS_APP_BASE_URL",
    process.env.BUSINESS_APP_BASE_URL,
  );
  const businessAppCallbackUrl = parseBaseUrl(
    "BUSINESS_APP_CALLBACK_URL",
    process.env.BUSINESS_APP_CALLBACK_URL,
  );

  if (
    businessAppCallbackUrl.origin !== businessAppBaseUrl.origin ||
    !businessAppCallbackUrl.pathname.startsWith("/") ||
    businessAppCallbackUrl.pathname === "/"
  ) {
    throw new Error(
      "BUSINESS_APP_CALLBACK_URL must be a non-root URL on BUSINESS_APP_BASE_URL's origin.",
    );
  }

  return { authBaseUrl, businessAppBaseUrl, businessAppCallbackUrl };
}
