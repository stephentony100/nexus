import { timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { runPolicyCycle } from 'policyloop'
import type { WalrusUploader, PolicyLoopOptions } from 'policyloop'
import type { TransactionSigner } from 'agentrunner'
import type { ApiConfig } from './config.js'

export interface ServerDeps {
  config: ApiConfig
  signer: TransactionSigner
  uploader: WalrusUploader
  scallop?: PolicyLoopOptions['scallop']
  ai?: PolicyLoopOptions['ai']
}

export interface BuildServerOptions {
  deps: ServerDeps
  logger?: FastifyServerOptions['logger']
}

export function buildServer({ deps, logger = false }: BuildServerOptions): FastifyInstance {
  const { config, signer, uploader, scallop, ai } = deps

  const fastify = Fastify({ logger })

  fastify.setErrorHandler(async (err, _request, reply) => {
    console.error(err)
    return reply.status(500).send({ error: 'internal_error' })
  })

  // Public scope — no auth required
  fastify.register(async (pub) => {
    pub.get('/live', async () => ({ status: 'ok' as const }))
  })

  // Protected scope — auth hook applies to all routes registered here
  fastify.register(async (prot) => {
    const secretBytes = Buffer.from(config.secretKey)

    prot.addHook('onRequest', async (request, reply) => {
      const raw = request.headers['x-api-key']
      const provided = typeof raw === 'string' ? Buffer.from(raw) : Buffer.alloc(0)
      const valid =
        provided.length === secretBytes.length && timingSafeEqual(provided, secretBytes)
      if (!valid) {
        return reply.status(401).send({ error: 'unauthorized' })
      }
    })

    prot.get('/health', async () => ({ status: 'ok' as const }))

    prot.get('/version', async () => ({ version: '0.1.0' }))

    prot.post<{ Params: { id: string } }>('/policies/:id/run-cycle', async (request, reply) => {
      const { id } = request.params
      if (!config.allowedPolicyIds.has(id)) {
        return reply.status(403).send({ error: 'policy_not_allowed', policyId: id })
      }
      const result = await runPolicyCycle({
        policyId: id,
        packageId: config.packageId,
        walrus: { uploader },
        signer,
        scallop,
        ai,
      })
      return result
    })
  })

  return fastify
}
