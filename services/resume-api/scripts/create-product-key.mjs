import { createHash, randomBytes, randomUUID } from 'node:crypto'

const productKey = `mix_live_${randomBytes(24).toString('base64url')}`
// Product keys have 192 bits of entropy. A SHA-256 hash is sufficient for
// database lookup and avoids coupling key issuance to a Worker-only secret.
const keyHash = createHash('sha256').update(productKey).digest('hex')
const id = randomUUID()

console.log('Give this product key to the customer once:')
console.log(productKey)
console.log('\nInsert only this hash into D1:')
console.log(keyHash)
console.log('\nProduct key record id:')
console.log(id)
