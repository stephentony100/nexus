import Fastify, { type FastifyInstance } from 'fastify'
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

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, signer, uploader, scallop, ai } = deps

  const fastify = Fastify({ logger: false })

  // Auth hook — applied to all routes
  fastify.addHook('onRequest', async (request, reply) => {
    const key = request.headers['x-api-key']
    if (key !== config.secretKey) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })

  fastify.get('/health', async () => ({ status: 'ok' as const }))

  fastify.get('/version', async () => ({ version: '0.1.0' }))

  fastify.post<{ Params: { id: string } }>('/policies/:id/run-cycle', async (request, reply) => {
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

  return fastify
}
