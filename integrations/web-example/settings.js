/**
 * Canonical browser settings and proxy credential resolver.
 *
 * Credentials are kept in browser storage for this demo, but are only sent
 * to a proxy in the X-AI-Provider-Credentials header. They are never added to
 * request JSON, URLs, or user-visible status text.
 */
(function () {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    mode: "ai-powered:connection:mode",
    proxyUrl: "ai-powered:connection:proxy-url",
    provider: "ai-powered:direct:provider",
    apiKeyPrefix: "ai-powered:direct:api-key:",
    callerCredential: "ai-powered:proxy:caller-credential",
    callerCredentialType: "ai-powered:proxy:caller-credential-type",
    budget: "ai-powered:direct:budget-usd",
  });

  const PROVIDER_LABELS = Object.freeze({
    openai: "OpenAI",
    anthropic: "Anthropic",
    venice: "Venice",
    xai: "xAI",
    openrouter: "OpenRouter",
    pika: "Pika",
    "google-lyria": "Google Lyria",
    "elevenlabs-music": "ElevenLabs Music",
    mureka: "Mureka",
    "stability-audio": "Stability Stable Audio",
    mubert: "Mubert",
    apiframe: "Apiframe",
    "kie-suno": "Kie Suno",
    "ace-suno": "Ace Data Cloud Suno",
    musicapi: "MusicAPI.ai",
    udioapi: "udioapi.pro",
    "apipass-suno": "ApiPass Suno",
    sunor: "Sunor Suno and Udio",
  });

  function isTrustedProxyUrl(proxyUrl) {
    try {
      const target = new URL(proxyUrl || window.location.href);
      if (target.protocol !== "http:" && target.protocol !== "https:") return false;
      return (
        target.hostname === "localhost" ||
        target.hostname === "127.0.0.1" ||
        target.origin === window.location.origin
      );
    } catch {
      return false;
    }
  }

  const safeStorage = (storage) => ({
    get(key) {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  });

  function normalizeProvider(provider) {
    return typeof provider === "string" && PROVIDER_LABELS[provider] ? provider : "openai";
  }

  function credentialStorageKey(provider) {
    return `${STORAGE_KEYS.apiKeyPrefix}${normalizeProvider(provider)}`;
  }

  function readCredential(provider) {
    const key = credentialStorageKey(provider);
    const local = safeStorage(localStorage).get(key);
    if (typeof local === "string" && local.trim()) return local.trim();
    const session = safeStorage(sessionStorage).get(key);
    return typeof session === "string" ? session.trim() : "";
  }

  function readCredentialPayload(provider) {
    const raw = readCredential(provider);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Plain provider keys remain the canonical format for one-field providers.
    }
    return { apiKey: raw };
  }

  function normalizeCallerCredentialType(type) {
    return type === "bearer" || type === "agent-key" || type === "api-key" ? type : "agent-key";
  }

  function readCallerCredential() {
    const value =
      safeStorage(localStorage).get(STORAGE_KEYS.callerCredential) ||
      safeStorage(sessionStorage).get(STORAGE_KEYS.callerCredential) ||
      "";
    if (!value.trim()) return undefined;
    const type = normalizeCallerCredentialType(
      safeStorage(localStorage).get(STORAGE_KEYS.callerCredentialType) ||
        safeStorage(sessionStorage).get(STORAGE_KEYS.callerCredentialType),
    );
    return { type, value: value.trim() };
  }

  function readState() {
    const local = safeStorage(localStorage);
    const mode = local.get(STORAGE_KEYS.mode) === "direct" ? "direct" : "proxy";
    return {
      mode,
      proxyUrl: local.get(STORAGE_KEYS.proxyUrl) || "",
      provider: normalizeProvider(local.get(STORAGE_KEYS.provider)),
      budget: local.get(STORAGE_KEYS.budget) || "",
      callerCredential: readCallerCredential(),
    };
  }

  function encodeCredentials(payload) {
    if (!payload) return undefined;
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function callerHeaders(proxyUrl, callerCredential) {
    const headers = {};
    if (!isTrustedProxyUrl(proxyUrl || readState().proxyUrl)) return headers;
    const credential = callerCredential ?? readCallerCredential();
    if (!credential || !credential.value) return headers;
    if (credential.type === "bearer") headers.Authorization = "Bearer " + credential.value;
    if (credential.type === "agent-key") headers["X-AI-Agent-Key"] = credential.value;
    if (credential.type === "api-key") headers["X-AI-API-Key"] = credential.value;
    return headers;
  }

  function proxyHeaders(provider, proxyUrl, options) {
    const headers =
      options?.includeContentType === false ? {} : { "Content-Type": "application/json" };
    const target = proxyUrl || readState().proxyUrl;
    if (!isTrustedProxyUrl(target)) return headers;
    Object.assign(headers, callerHeaders(target, options?.callerCredential));
    if (options?.includeProvider !== false) {
      const encoded = encodeCredentials(readCredentialPayload(provider));
      if (encoded) headers["X-AI-Provider-Credentials"] = encoded;
    }
    return headers;
  }

  function credentialForRequest(provider) {
    return readCredentialPayload(provider);
  }

  window.AiPoweredSettings = Object.freeze({
    STORAGE_KEYS,
    PROVIDER_LABELS,
    isTrustedProxyUrl,
    normalizeProvider,
    credentialStorageKey,
    readCredential,
    readCredentialPayload,
    credentialForRequest,
    callerCredentialForRequest: readCallerCredential,
    callerHeaders,
    normalizeCallerCredentialType,
    proxyHeaders,
    readState,
  });
})();
