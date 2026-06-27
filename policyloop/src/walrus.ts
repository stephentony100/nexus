import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { WalrusClient } from '@mysten/walrus'

export interface WalrusUploader {
  uploadJson(input: {
    data: unknown
    epochs?: number
    deletable?: boolean
  }): Promise<{ blobId: string; blobObjectId?: string }>
}

export interface WalrusClientConfig {
  network: 'testnet' | 'mainnet'
}

export class WalrusUploaderImpl implements WalrusUploader {
  private readonly client: WalrusClient

  constructor(private readonly opts: { config: WalrusClientConfig; signer: Ed25519Keypair }) {
    const suiClient = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(opts.config.network),
      network: opts.config.network,
    })
    this.client = new WalrusClient({ network: opts.config.network, suiClient })
  }

  async uploadJson(input: { data: unknown; epochs?: number; deletable?: boolean }) {
    const blob = new TextEncoder().encode(JSON.stringify(input.data))
    const result = await this.client.writeBlob({
      blob,
      epochs: input.epochs ?? 1,
      deletable: input.deletable ?? false,
      signer: this.opts.signer,
    })
    // blobObject is non-optional in current SDK but interface keeps blobObjectId optional for forward compatibility
    return { blobId: result.blobId, blobObjectId: result.blobObject?.id }
  }
}
