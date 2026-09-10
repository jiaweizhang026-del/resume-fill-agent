const JSON_HEADERS = {
	'content-type': 'application/json; charset=utf-8',
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type',
	'access-control-max-age': '86400',
}

const MAX_REQUEST_BYTES = 1_000_000
const DEFAULT_MODEL = 'deepseek-chat'
const TASK_COST = 1

const PRIVACY_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>履历助手 Agent 隐私政策</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222}h1{line-height:1.3}small{color:#666}</style><h1>履历助手 Agent 隐私政策</h1><small>更新日期：2026-09-09</small><h2>处理哪些信息</h2><p>扩展在浏览器本地保存你主动提供的履历、产品 Key 和设置。你发起任务时，扩展会将任务文字、履历及完成填写所需的页面内容发送到产品网关 api.jawi.top，再转发给 DeepSeek 生成操作建议。页面内容可能包含个人身份信息、网页地址、用户操作相关上下文和网站文字。</p><h2>用途</h2><p>这些信息仅用于理解当前页面并辅助填写招聘或网申表单。产品 Key 仅用于访问控制和额度扣减；服务端保存 Key 的哈希、状态、剩余额度和最近使用时间，不保存原始 Key、履历正文或页面正文。</p><h2>第三方处理</h2><p>模型请求由 DeepSeek 处理；网络基础设施由 Cloudflare Workers 和 D1 提供。请仅在你愿意进行上述处理的页面发起任务，并自行核对填写结果。</p><h2>保留与删除</h2><p>本地履历和历史记录可在扩展设置中删除。网关只保留产品 Key 的哈希及额度管理记录；如需查询或删除服务记录，请联系 <a href="mailto:jiaweizhang026@gmail.com">jiaweizhang026@gmail.com</a>。</p><h2>联系我们</h2><p>邮箱：<a href="mailto:jiaweizhang026@gmail.com">jiaweizhang026@gmail.com</a></p></html>`

/** @typedef {{ PRODUCT_KEYS: D1Database, DEEPSEEK_API_KEY: string, DEEPSEEK_MODEL?: string }} Env */

/** @param {unknown} value @param {number} status */
function json(value, status = 200) {
	return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

/** @param {Request} request */
function getProductKey(request) {
	const authorization = request.headers.get('authorization') || ''
	if (!authorization.startsWith('Bearer ')) return null

	const key = authorization.slice('Bearer '.length).trim()
	return key || null
}

/** @param {string} value */
function utf8(value) {
	return new TextEncoder().encode(value)
}

/** @param {string} value */
async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', utf8(value))
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/** @param {string} productKey @param {Env} env */
function hashProductKey(productKey) {
	return sha256(productKey)
}

/** @param {Request} request */
async function parseRequestBody(request) {
	const contentLength = Number(request.headers.get('content-length') || '0')
	if (contentLength > MAX_REQUEST_BYTES) {
		throw new Response('Request body is too large', { status: 413, headers: JSON_HEADERS })
	}

	const body = await request.text()
	if (body.length > MAX_REQUEST_BYTES) {
		throw new Response('Request body is too large', { status: 413, headers: JSON_HEADERS })
	}

	try {
		return JSON.parse(body)
	} catch {
		throw new Response('Request body must be valid JSON', { status: 400, headers: JSON_HEADERS })
	}
}

/** @param {Env} env @param {string} keyHash */
async function reserveCredit(env, keyHash) {
	const now = new Date().toISOString()
	const result = await env.PRODUCT_KEYS.prepare(
		`UPDATE product_keys
		 SET credit_units = credit_units - ?, last_used_at = ?
		 WHERE key_hash = ?
		   AND status = 'active'
		   AND credit_units >= ?
		   AND (expires_at IS NULL OR expires_at > ?)`,
	)
		.bind(TASK_COST, now, keyHash, TASK_COST, now)
		.run()

	return result.meta.changes === 1
}

/** @param {Env} env @param {string} keyHash */
async function refundCredit(env, keyHash) {
	await env.PRODUCT_KEYS.prepare(
		'UPDATE product_keys SET credit_units = credit_units + ? WHERE key_hash = ?',
	)
		.bind(TASK_COST, keyHash)
		.run()
}

/**
 * `reserveCredit` intentionally does the invalid/disabled/expired/out-of-credit
 * check as a single atomic UPDATE (so a concurrent request can't double-spend
 * the last credit unit), but that means a failed reservation alone can't tell
 * us *why* it failed. Run a plain read-only lookup afterwards purely to build
 * an accurate, user-actionable error response - never to gate the reservation
 * itself.
 *
 * @param {Env} env @param {string} keyHash
 * @returns {Promise<{ status: number, error: string, message: string }>}
 */
async function describeKeyFailure(env, keyHash) {
	const record = await env.PRODUCT_KEYS.prepare(
		'SELECT status, credit_units, expires_at FROM product_keys WHERE key_hash = ?',
	)
		.bind(keyHash)
		.first()

	if (!record) {
		return {
			status: 401,
			error: 'invalid_key',
			message: 'This product key was not recognized.',
		}
	}
	if (record.status !== 'active') {
		return {
			status: 403,
			error: 'key_disabled',
			message: 'This product key has been disabled.',
		}
	}
	const now = new Date().toISOString()
	if (record.expires_at && record.expires_at <= now) {
		return {
			status: 403,
			error: 'key_expired',
			message: 'This product key has expired.',
		}
	}
	if (record.credit_units < TASK_COST) {
		return {
			status: 402,
			error: 'insufficient_credit',
			message: 'This product key has run out of usage credit. Please top up to continue.',
		}
	}
	// Record looked valid on this read but the atomic reservation still failed -
	// most likely a race with a concurrent request that just spent the last
	// unit. Report it as out-of-credit since that's the closest accurate reason.
	return {
		status: 402,
		error: 'insufficient_credit',
		message: 'This product key has no usage credit available right now. Please try again or top up.',
	}
}

/** @param {Request} request @param {Env} env */
async function proxyChatCompletion(request, env) {
	if (!env.DEEPSEEK_API_KEY) return json({ error: 'Model gateway is not configured' }, 503)

	const productKey = getProductKey(request)
	if (!productKey) return json({ error: 'A product key is required' }, 401)

	const keyHash = await hashProductKey(productKey)
	const creditReserved = await reserveCredit(env, keyHash)
	if (!creditReserved) {
		const failure = await describeKeyFailure(env, keyHash)
		return json({ error: failure.error, message: failure.message }, failure.status)
	}

	let body
	try {
		body = await parseRequestBody(request)
	} catch (error) {
		await refundCredit(env, keyHash)
		if (error instanceof Response) return error
		return json({ error: 'Unable to read request body' }, 400)
	}

	if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
		await refundCredit(env, keyHash)
		return json({ error: 'messages must be an array' }, 400)
	}

	const upstreamBody = {
		...body,
		model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
		stream: false,
	}

	let upstream
	try {
		upstream = await fetch('https://api.deepseek.com/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(upstreamBody),
		})
	} catch {
		await refundCredit(env, keyHash)
		return json({ error: 'Unable to reach the model provider' }, 502)
	}

	const responseText = await upstream.text()
	if (!upstream.ok) {
		await refundCredit(env, keyHash)
		return new Response(responseText, {
			status: upstream.status,
			headers: JSON_HEADERS,
		})
	}

	return new Response(responseText, { status: 200, headers: JSON_HEADERS })
}

export default {
	/** @param {Request} request @param {Env} env */
	async fetch(request, env) {
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })

		const url = new URL(request.url)
		if (request.method === 'GET' && url.pathname === '/privacy') {
			return new Response(PRIVACY_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
		}
		if (request.method === 'GET' && url.pathname === '/health') {
			return json({ ok: true, service: 'resume-api', version: 1 })
		}

		if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
			return proxyChatCompletion(request, env)
		}

		return json({ error: 'Not found' }, 404)
	},
}
