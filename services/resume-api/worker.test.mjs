import assert from 'node:assert/strict'
import test from 'node:test'

import worker from './worker.js'

class TestD1 {
	constructor(rows) {
		this.rows = rows
	}

	prepare(sql) {
		return {
			bind: (...values) => ({
				run: async () => {
					if (sql.includes('credit_units = credit_units -')) {
						const [, now, keyHash] = values
						const row = this.rows.get(keyHash)
						const canUse =
							row &&
							row.status === 'active' &&
							row.creditUnits >= 1 &&
							(!row.expiresAt || row.expiresAt > now)

						if (!canUse) return { meta: { changes: 0 } }
						row.creditUnits -= 1
						return { meta: { changes: 1 } }
					}

					if (sql.includes('credit_units = credit_units +')) {
						const [, keyHash] = values
						this.rows.get(keyHash).creditUnits += 1
						return { meta: { changes: 1 } }
					}

					throw new Error(`Unexpected D1 query: ${sql}`)
				},
				first: async () => {
					if (sql.includes('SELECT') && sql.includes('FROM product_keys')) {
						const [keyHash] = values
						const row = this.rows.get(keyHash)
						if (!row) return null
						return {
							status: row.status,
							credit_units: row.creditUnits,
							expires_at: row.expiresAt,
						}
					}

					throw new Error(`Unexpected D1 query: ${sql}`)
				},
			}),
		}
	}
}

async function makeHash(key) {
	const data = new TextEncoder().encode(key)
	const digest = await crypto.subtle.digest('SHA-256', data)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

function makeEnv(rows, overrides = {}) {
	return {
		PRODUCT_KEYS: new TestD1(rows),
		DEEPSEEK_API_KEY: 'upstream-secret',
		DEEPSEEK_MODEL: 'deepseek-chat',
		...overrides,
	}
}

test('health endpoint is public', async () => {
	const response = await worker.fetch(new Request('https://api.example.com/health'), {})
	assert.equal(response.status, 200)
	assert.deepEqual(await response.json(), { ok: true, service: 'resume-api', version: 1 })
})

test('valid product key is charged and forwarded without exposing it upstream', async () => {
	const productKey = 'mix_live_test-key'
	const keyHash = await makeHash(productKey)
	const rows = new Map([[keyHash, { status: 'active', creditUnits: 2, expiresAt: null }]])
	const originalFetch = globalThis.fetch
	let upstreamRequest

	globalThis.fetch = async (url, options) => {
		upstreamRequest = { url, options }
		return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
			status: 200,
		})
	}

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${productKey}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'unexpected-model', messages: [{ role: 'user', content: 'Hi' }] }),
			}),
			makeEnv(rows),
		)

		assert.equal(response.status, 200)
		assert.equal(rows.get(keyHash).creditUnits, 1)
		assert.equal(upstreamRequest.url, 'https://api.deepseek.com/chat/completions')
		assert.equal(upstreamRequest.options.headers.Authorization, 'Bearer upstream-secret')
		assert.equal(JSON.parse(upstreamRequest.options.body).model, 'deepseek-chat')
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('unknown product key cannot reach DeepSeek', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = async () => {
		throw new Error('The upstream model must not be called')
	}

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: 'Bearer mix_live_invalid' },
				body: JSON.stringify({ messages: [] }),
			}),
			makeEnv(new Map()),
		)

		assert.equal(response.status, 401)
		assert.equal((await response.json()).error, 'invalid_key')
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('disabled product key is rejected with a clear reason', async () => {
	const productKey = 'mix_live_disabled'
	const keyHash = await makeHash(productKey)
	const rows = new Map([[keyHash, { status: 'disabled', creditUnits: 5, expiresAt: null }]])
	const originalFetch = globalThis.fetch
	globalThis.fetch = async () => {
		throw new Error('The upstream model must not be called')
	}

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${productKey}` },
				body: JSON.stringify({ messages: [] }),
			}),
			makeEnv(rows),
		)

		assert.equal(response.status, 403)
		assert.equal((await response.json()).error, 'key_disabled')
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('expired product key is rejected with a clear reason', async () => {
	const productKey = 'mix_live_expired'
	const keyHash = await makeHash(productKey)
	const rows = new Map([
		[keyHash, { status: 'active', creditUnits: 5, expiresAt: '2000-01-01T00:00:00.000Z' }],
	])
	const originalFetch = globalThis.fetch
	globalThis.fetch = async () => {
		throw new Error('The upstream model must not be called')
	}

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${productKey}` },
				body: JSON.stringify({ messages: [] }),
			}),
			makeEnv(rows),
		)

		assert.equal(response.status, 403)
		assert.equal((await response.json()).error, 'key_expired')
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('product key out of credit gets a 402 with an actionable reason (not a bare auth failure)', async () => {
	const productKey = 'mix_live_out-of-credit'
	const keyHash = await makeHash(productKey)
	const rows = new Map([[keyHash, { status: 'active', creditUnits: 0, expiresAt: null }]])
	const originalFetch = globalThis.fetch
	globalThis.fetch = async () => {
		throw new Error('The upstream model must not be called')
	}

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${productKey}` },
				body: JSON.stringify({ messages: [] }),
			}),
			makeEnv(rows),
		)

		assert.equal(response.status, 402)
		const body = await response.json()
		assert.equal(body.error, 'insufficient_credit')
		assert.match(body.message, /top up/i)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('failed DeepSeek request refunds the reserved credit', async () => {
	const productKey = 'mix_live_refund-test'
	const keyHash = await makeHash(productKey)
	const rows = new Map([[keyHash, { status: 'active', creditUnits: 1, expiresAt: null }]])
	const originalFetch = globalThis.fetch
	globalThis.fetch = async () => new Response('{"error":"rate limited"}', { status: 429 })

	try {
		const response = await worker.fetch(
			new Request('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${productKey}` },
				body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
			}),
			makeEnv(rows),
		)

		assert.equal(response.status, 429)
		assert.equal(rows.get(keyHash).creditUnits, 1)
	} finally {
		globalThis.fetch = originalFetch
	}
})
