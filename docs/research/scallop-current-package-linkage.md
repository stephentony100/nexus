# Scallop Current-Package Linkage Evidence

## Scope

Verify immutable dependency linkage to the current Scallop package. No production Nexus changes.

## Mainnet Package Evidence

RPC endpoint: `https://fullnode.mainnet.sui.io:443`

Current call package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`

`sui_getObject` was called with `showBcs=true`.

has_mint_module=True

market::Market origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

reserve::MarketCoin origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

version::Version origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

Complete `sui_getNormalizedMoveFunction` response for module `mint`, function `mint`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "visibility": "Public",
    "isEntry": false,
    "typeParameters": [
      {
        "abilities": []
      }
    ],
    "parameters": [
      {
        "Reference": {
          "Struct": {
            "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
            "module": "version",
            "name": "Version",
            "typeArguments": []
          }
        }
      },
      {
        "MutableReference": {
          "Struct": {
            "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
            "module": "market",
            "name": "Market",
            "typeArguments": []
          }
        }
      },
      {
        "Struct": {
          "address": "0x2",
          "module": "coin",
          "name": "Coin",
          "typeArguments": [
            {
              "TypeParameter": 0
            }
          ]
        }
      },
      {
        "Reference": {
          "Struct": {
            "address": "0x2",
            "module": "clock",
            "name": "Clock",
            "typeArguments": []
          }
        }
      },
      {
        "MutableReference": {
          "Struct": {
            "address": "0x2",
            "module": "tx_context",
            "name": "TxContext",
            "typeArguments": []
          }
        }
      }
    ],
    "return": [
      {
        "Struct": {
          "address": "0x2",
          "module": "coin",
          "name": "Coin",
          "typeArguments": [
            {
              "Struct": {
                "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
                "module": "reserve",
                "name": "MarketCoin",
                "typeArguments": [
                  {
                    "TypeParameter": 0
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```
