/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/wxmr_bridge.json`.
 */
export type WxmrBridge = {
  "address": "EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8",
  "metadata": {
    "name": "wxmrBridge",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "wXMR Bridge - Solana to Monero"
  },
  "instructions": [
    {
      "name": "assignDepositAddress",
      "docs": [
        "admin function"
      ],
      "discriminator": [
        108,
        239,
        151,
        163,
        214,
        28,
        41,
        254
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deposit",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "xmrAddress",
          "type": "string"
        }
      ]
    },
    {
      "name": "claimPendingMint",
      "docs": [
        "User claims pending tokens after creating their own ATA",
        "This transfers tokens from the pending account (owned by deposit PDA) to user's ATA",
        "and closes the pending account, refunding rent to bridge authority"
      ],
      "discriminator": [
        231,
        97,
        226,
        31,
        241,
        172,
        157,
        190
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deposit",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "deposit"
          ]
        },
        {
          "name": "pendingTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "deposit"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "wxmrMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "wxmrMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "wxmrMint",
          "address": "WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp",
          "relations": [
            "config"
          ]
        },
        {
          "name": "authority",
          "writable": true,
          "address": "Ds4prSZNwyxTz4PZmHXoHDXFzLZ1c8MkfhUwGtqvAvpK",
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeDepositAccount",
      "docs": [
        "User closes their deposit account to get a new XMR address",
        "Rent goes to authority (the subaddress is now abandoned/wasted)",
        "User must create a new deposit account to get a fresh address"
      ],
      "discriminator": [
        152,
        6,
        13,
        164,
        50,
        219,
        225,
        43
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deposit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "writable": true,
          "address": "Ds4prSZNwyxTz4PZmHXoHDXFzLZ1c8MkfhUwGtqvAvpK",
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "completeWithdrawal",
      "docs": [
        "Backend completes withdrawal after sending XMR - closes PDA and refunds rent to user",
        "Can be called from Pending (legacy) or Sending state"
      ],
      "discriminator": [
        107,
        98,
        134,
        131,
        74,
        120,
        174,
        121
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "withdrawal",
          "writable": true
        },
        {
          "name": "user",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "xmrTxHash",
          "type": "string"
        },
        {
          "name": "xmrTxKey",
          "type": "string"
        }
      ]
    },
    {
      "name": "createAuditRecord",
      "docs": [
        "Initialize the AMM pool (authority only)",
        "Add liquidity to the AMM (authority only)",
        "Remove liquidity from the AMM (authority only)",
        "Update AMM prices (authority only - oracle)",
        "Enable or disable AMM trading (authority only)",
        "Buy wXMR with USDC",
        "Sell wXMR for USDC",
        "Create an audit record for epoch consolidation (authority only)",
        "Account size is dynamic based on initial data length"
      ],
      "discriminator": [
        247,
        223,
        36,
        206,
        121,
        62,
        176,
        26
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "audit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  100,
                  105,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "epoch"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "circulatingSupply",
          "type": "u64"
        },
        {
          "name": "spendableBalance",
          "type": "u64"
        },
        {
          "name": "unconfirmedBalance",
          "type": "u64"
        },
        {
          "name": "data",
          "type": "string"
        }
      ]
    },
    {
      "name": "createDepositAccount",
      "docs": [
        "Create token metadata for wXMR mint (authority only, one-time)",
        "This uses CPI to Metaplex Token Metadata program, with config PDA signing as mint authority",
        "Public",
        "User creates their permanent deposit account (one per wallet)",
        "Rent serves as spam deterrent - user pays ~0.002 SOL to create"
      ],
      "discriminator": [
        25,
        217,
        82,
        207,
        22,
        150,
        122,
        181
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deposit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "extendAuditData",
      "docs": [
        "Append data to an existing audit record (authority only)",
        "Reallocates the account to fit additional data"
      ],
      "discriminator": [
        180,
        105,
        90,
        172,
        234,
        218,
        238,
        34
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "audit",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "additionalData",
          "type": "string"
        }
      ]
    },
    {
      "name": "markWithdrawalSending",
      "docs": [
        "Backend marks withdrawal as sending BEFORE attempting XMR transfer",
        "This prevents double-spend: once marked Sending, cannot be reverted",
        "Backend calls this before sendXmr(), then complete after XMR is sent"
      ],
      "discriminator": [
        50,
        143,
        96,
        235,
        25,
        104,
        34,
        115
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "withdrawal",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "mintDeposit",
      "docs": [
        "admin function",
        "if token account doesn't exist, put amount in pending section"
      ],
      "discriminator": [
        171,
        65,
        49,
        61,
        7,
        88,
        11,
        9
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deposit",
          "docs": [
            "Deposit account - stays open, no close constraint"
          ],
          "writable": true
        },
        {
          "name": "wxmrMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "pendingTokenAccount",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "removeFeeOverride",
      "docs": [
        "admin function",
        "Remove a user from the fee whitelist - they revert to the global fee.",
        "Rent is refunded to the authority."
      ],
      "discriminator": [
        237,
        246,
        238,
        80,
        226,
        26,
        85,
        244
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "feeOverride",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  111,
                  118,
                  101,
                  114,
                  114,
                  105,
                  100,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "user",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "requestWithdrawal",
      "docs": [
        "Request withdrawal - burns wXMR and creates a withdrawal PDA.",
        "`exact_out` selects how `amount` relates to the protocol fee:",
        "- false (fee-inclusive): `amount` is the total wXMR debited; the fee is taken",
        "out of it and the remaining net = amount - fee is burned and paid out as XMR.",
        "- true  (fee-exclusive): `amount` is the exact net XMR the user receives (and",
        "burns); the debit is grossed up so gross - fee == amount, i.e.",
        "gross = amount / (1 - fee_bps/denom). The user spends `amount + fee` wXMR total."
      ],
      "discriminator": [
        251,
        85,
        121,
        205,
        56,
        201,
        12,
        177
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "withdrawal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "wxmrMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "feeTreasury",
          "docs": [
            "Config-owned treasury that receives the wXMR fee."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "feeOverride",
          "docs": [
            "validated by seeds; the account may be uninitialized, in which case the",
            "global fee applies. Read-only."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  111,
                  118,
                  101,
                  114,
                  114,
                  105,
                  100,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "xmrAddress",
          "type": "string"
        },
        {
          "name": "exactOut",
          "type": "bool"
        }
      ]
    },
    {
      "name": "revertWithdrawal",
      "docs": [
        "Authority reverts a withdrawal - re-mints tokens to user",
        "ONLY allowed in Pending state (before XMR send attempted)",
        "Once marked as Sending, CANNOT be reverted - must complete"
      ],
      "discriminator": [
        161,
        23,
        14,
        3,
        20,
        72,
        4,
        121
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "withdrawal",
          "writable": true
        },
        {
          "name": "wxmrMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "feeTreasury",
          "docs": [
            "Config-owned treasury that refunds the wXMR fee on revert."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "setFeeBps",
      "docs": [
        "Initialize the bridge config and create the config-owned wXMR fee treasury.",
        "admin function",
        "Grow an existing BridgeConfig account that predates the `fee_bps` field so",
        "the current program can deserialize it. Reallocs the account to the new size",
        "and zero-fills the appended bytes (fee_bps = 0). Idempotent and authority-only.",
        "admin function",
        "Create the config-owned wXMR fee treasury for a deployment that was",
        "initialized before the fee feature existed (initialize cannot be re-run).",
        "Idempotent - a no-op if the treasury already exists.",
        "admin function",
        "Set the withdrawal fee in basis points (0 = disabled, 10_000 = 100%)."
      ],
      "discriminator": [
        2,
        161,
        245,
        141,
        111,
        32,
        39,
        198
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setFeeOverride",
      "docs": [
        "admin function",
        "Add or update a per-user withdrawal fee override (the \"fee whitelist\").",
        "`fee_bps` is the custom fee for that user (0 = free withdrawals) and can be",
        "adjusted at any time. Only the config authority may call this."
      ],
      "discriminator": [
        238,
        6,
        44,
        194,
        50,
        78,
        93,
        3
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "feeOverride",
          "docs": [
            "Per-user fee override PDA. Created on first set, updated thereafter."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  111,
                  118,
                  101,
                  114,
                  114,
                  105,
                  100,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "user",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateTokenMetadata",
      "docs": [
        "admin function"
      ],
      "discriminator": [
        243,
        6,
        8,
        23,
        126,
        181,
        251,
        158
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "wxmrMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "auditRecord",
      "discriminator": [
        23,
        133,
        250,
        12,
        85,
        60,
        64,
        139
      ]
    },
    {
      "name": "bridgeConfig",
      "discriminator": [
        40,
        206,
        51,
        233,
        246,
        40,
        178,
        85
      ]
    },
    {
      "name": "depositRecord",
      "discriminator": [
        83,
        232,
        10,
        31,
        251,
        49,
        189,
        167
      ]
    },
    {
      "name": "feeOverride",
      "discriminator": [
        45,
        33,
        41,
        248,
        253,
        236,
        239,
        85
      ]
    },
    {
      "name": "withdrawalRecord",
      "discriminator": [
        88,
        59,
        154,
        202,
        216,
        210,
        211,
        237
      ]
    }
  ],
  "events": [
    {
      "name": "ammEnabledChangedEvent",
      "discriminator": [
        127,
        244,
        132,
        195,
        132,
        145,
        218,
        180
      ]
    },
    {
      "name": "ammInitializedEvent",
      "discriminator": [
        182,
        106,
        212,
        61,
        61,
        142,
        176,
        7
      ]
    },
    {
      "name": "auditRecordCreatedEvent",
      "discriminator": [
        240,
        13,
        164,
        165,
        151,
        62,
        2,
        162
      ]
    },
    {
      "name": "depositAccountClosedEvent",
      "discriminator": [
        61,
        150,
        159,
        160,
        136,
        66,
        119,
        96
      ]
    },
    {
      "name": "depositAccountCreatedEvent",
      "discriminator": [
        179,
        110,
        80,
        76,
        96,
        188,
        243,
        68
      ]
    },
    {
      "name": "depositAddressAssignedEvent",
      "discriminator": [
        157,
        192,
        51,
        141,
        167,
        184,
        6,
        248
      ]
    },
    {
      "name": "depositMintedEvent",
      "discriminator": [
        187,
        199,
        161,
        126,
        73,
        247,
        28,
        44
      ]
    },
    {
      "name": "feeBpsUpdatedEvent",
      "discriminator": [
        76,
        157,
        212,
        224,
        3,
        54,
        39,
        55
      ]
    },
    {
      "name": "feeOverrideRemovedEvent",
      "discriminator": [
        127,
        181,
        64,
        26,
        35,
        3,
        131,
        172
      ]
    },
    {
      "name": "feeOverrideSetEvent",
      "discriminator": [
        3,
        104,
        73,
        239,
        148,
        127,
        209,
        34
      ]
    },
    {
      "name": "liquidityAddedEvent",
      "discriminator": [
        220,
        104,
        7,
        39,
        147,
        1,
        194,
        142
      ]
    },
    {
      "name": "liquidityRemovedEvent",
      "discriminator": [
        233,
        117,
        13,
        70,
        229,
        1,
        106,
        215
      ]
    },
    {
      "name": "priceUpdatedEvent",
      "discriminator": [
        217,
        171,
        222,
        24,
        64,
        152,
        217,
        36
      ]
    },
    {
      "name": "swapEvent",
      "discriminator": [
        64,
        198,
        205,
        232,
        38,
        8,
        113,
        226
      ]
    },
    {
      "name": "withdrawCompletedEvent",
      "discriminator": [
        192,
        162,
        40,
        197,
        83,
        94,
        198,
        66
      ]
    },
    {
      "name": "withdrawRequestedEvent",
      "discriminator": [
        21,
        86,
        249,
        76,
        80,
        238,
        207,
        154
      ]
    },
    {
      "name": "withdrawRevertedEvent",
      "discriminator": [
        41,
        94,
        186,
        33,
        56,
        24,
        133,
        80
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidMint",
      "msg": "Invalid wXMR mint (must match bridge config)"
    },
    {
      "code": 6001,
      "name": "invalidPrice",
      "msg": "Invalid price"
    },
    {
      "code": 6002,
      "name": "invalidSpread",
      "msg": "Invalid spread: buy price must be >= sell price"
    },
    {
      "code": 6003,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6004,
      "name": "amountTooSmall",
      "msg": "Amount too small"
    },
    {
      "code": 6005,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity in pool"
    },
    {
      "code": 6006,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6007,
      "name": "tradingDisabled",
      "msg": "Trading is disabled"
    },
    {
      "code": 6008,
      "name": "priceStale",
      "msg": "Price is stale (not updated within 2.1 minutes)"
    },
    {
      "code": 6009,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "ammEnabledChangedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ammInitializedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "buyPrice",
            "type": "u64"
          },
          {
            "name": "sellPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auditRecord",
      "docs": [
        "Audit record for epoch consolidation proof",
        "Contains all consolidation tx proofs and unconfirmed balance info in one record",
        "Data field is dynamically sized - account can be extended with extend_audit_data"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "spendableBalance",
            "type": "u64"
          },
          {
            "name": "unconfirmedBalance",
            "type": "u64"
          },
          {
            "name": "data",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "auditRecordCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "spendableBalance",
            "type": "u64"
          },
          {
            "name": "unconfirmedBalance",
            "type": "u64"
          },
          {
            "name": "dataLen",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "bridgeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "wxmrMint",
            "type": "pubkey"
          },
          {
            "name": "totalDeposits",
            "type": "u64"
          },
          {
            "name": "totalWithdrawals",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "feeBps",
            "docs": [
              "Withdrawal fee in basis points (0 = disabled). Fee is collected in wXMR.",
              "NOTE: kept LAST so the account can be grown in place via realloc + zero-fill",
              "(migrate_config) for configs created before this field existed."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "depositAccountClosedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositPda",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositAccountCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositPda",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositAddressAssignedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositPda",
            "type": "pubkey"
          },
          {
            "name": "xmrAddress",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "depositMintedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositPda",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "xmrDepositAddress",
            "type": "string"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "depositStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "active"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "feeBpsUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldFeeBps",
            "type": "u16"
          },
          {
            "name": "newFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "feeOverride",
      "docs": [
        "Per-user withdrawal fee override - the admin-managed \"fee whitelist\".",
        "Only writable by the config authority. When present, its fee_bps overrides the",
        "global fee for that user (0 = free withdrawals)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "feeOverrideRemovedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "feeOverrideSetEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "liquidityAddedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "wxmrAmount",
            "type": "u64"
          },
          {
            "name": "usdcAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityRemovedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "wxmrAmount",
            "type": "u64"
          },
          {
            "name": "usdcAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "oldBuyPrice",
            "type": "u64"
          },
          {
            "name": "oldSellPrice",
            "type": "u64"
          },
          {
            "name": "newBuyPrice",
            "type": "u64"
          },
          {
            "name": "newSellPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "swapDirection",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "buy"
          },
          {
            "name": "sell"
          }
        ]
      }
    },
    {
      "name": "swapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "swapDirection"
              }
            }
          },
          {
            "name": "wxmrAmount",
            "type": "u64"
          },
          {
            "name": "usdcAmount",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawCompletedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawalPda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "xmrAddress",
            "type": "string"
          },
          {
            "name": "xmrTxHash",
            "type": "string"
          },
          {
            "name": "xmrTxKey",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "withdrawRequestedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawalPda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "xmrAddress",
            "type": "string"
          },
          {
            "name": "exactOut",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawRevertedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawalPda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "reason",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "withdrawalRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "amount",
            "docs": [
              "Net amount (piconero) to be sent as XMR. Equals the burned wXMR (amount requested minus fee)."
            ],
            "type": "u64"
          },
          {
            "name": "xmrAddress",
            "type": "string"
          },
          {
            "name": "exactOut",
            "type": "bool"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "withdrawalStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "fee",
            "docs": [
              "wXMR fee transferred to the treasury at request time (0 if fee disabled)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawalStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "sending"
          },
          {
            "name": "completed"
          }
        ]
      }
    }
  ]
};
