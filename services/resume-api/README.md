# Resume API Worker

This Worker is the paid-model gateway for the Resume Fill extension. It does not store
the resume, the page DOM, or model prompts. It only validates a product key, reserves
one credit for a successful model request, and proxies the request to DeepSeek.

## Endpoints

- `GET /health` returns a public health response.
- `POST /v1/chat/completions` accepts an OpenAI-compatible chat completion request.
  It requires `Authorization: Bearer mix_live_...`.

The Worker always selects `DEEPSEEK_MODEL` (or `deepseek-chat`) and disables streaming,
so callers cannot silently choose a more expensive upstream model.

## Cloudflare setup

1. Create a D1 database named `resume-product-keys`.
2. Run `schema.sql` in that D1 database.
3. Put the D1 id into `wrangler.toml` and bind it as `PRODUCT_KEYS`.
4. Add these Worker secrets in Cloudflare:
   - `DEEPSEEK_API_KEY`: the upstream DeepSeek key. Never place it in the extension.
   - Optional `DEEPSEEK_MODEL`: normally `deepseek-chat`.
5. Deploy this folder with Wrangler, or replace the current dashboard Worker code with
   `worker.js` and configure the same D1 binding and secrets in the dashboard.

## Issuing a product key

Run this locally with a value that matches the Worker secret:

```bash
node scripts/create-product-key.mjs
```

The script prints a customer-facing `mix_live_...` key once and a hash. Only the hash
goes into D1. Insert a key with its initial balance, for example:

```sql
INSERT INTO product_keys (id, key_hash, label, credit_units)
VALUES ('generated-id', 'generated-key-hash', 'first paid user', 100);
```

Each successful `POST /v1/chat/completions` consumes one credit. Failed input and failed
upstream calls automatically refund the reservation.

## Extension configuration

Once deployed, the existing extension can use:

- Base URL: `https://api.jawi.top/v1`
- Model: any value (the gateway overrides it to the configured model)
- API key: the customer's `mix_live_...` product key

The next extension update will label these fields as product-service settings instead of
showing the upstream-provider terminology.
