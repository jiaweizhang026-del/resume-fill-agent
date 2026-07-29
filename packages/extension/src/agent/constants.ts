import type { LLMConfig } from '@page-agent/llms'

// Resume Fill routes model traffic through the product gateway. The gateway owns
// the upstream DeepSeek key; extension users only receive a product key.
export const DEMO_MODEL = 'deepseek-chat'
export const DEMO_BASE_URL = 'https://api.jawi.top/v1'

export const DEMO_CONFIG: LLMConfig = {
	baseURL: DEMO_BASE_URL,
	model: DEMO_MODEL,
	// apiKey: DEMO_API_KEY,
}

/**
 * This is a paid, gateway-only product. Any legacy or manually changed provider
 * endpoint is reset to the product gateway, and its provider key is discarded.
 */
export function enforceProductGateway(config: LLMConfig): LLMConfig {
	const normalized = config.baseURL.replace(/\/+$/, '')
	if (normalized === DEMO_BASE_URL && config.model === DEMO_MODEL) {
		return config
	}

	return normalized === DEMO_BASE_URL
		? { ...DEMO_CONFIG, apiKey: config.apiKey }
		: { ...DEMO_CONFIG }
}
