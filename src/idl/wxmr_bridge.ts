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
        "Backend assigns a Monero subaddress to the deposit account (one-time)"
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
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "writable": true,
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
        }
      ]
    },
    {
      "name": "createDepositAccount",
      "docs": [
        "Create token metadata for wXMR mint (authority only, one-time)",
        "This uses CPI to Metaplex Token Metadata program, with config PDA signing as mint authority",
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
      "name": "initialize",
      "docs": [
        "Initialize the bridge configuration"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
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
          "name": "wxmrMint",
          "writable": true
        },
        {
          "name": "authority",
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
      "name": "markWithdrawalSending",
      "docs": [
        "Backend marks withdrawal as sending BEFORE attempting XMR transfer",
        "This prevents double-spend: once marked Sending, cannot be reverted",
        "CRITICAL: Call this before sendXmr(), then complete after XMR is sent"
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
        "Backend mints wXMR for detected XMR deposits",
        "Deposit account stays open - user can deposit multiple times",
        "If recipient's token account doesn't exist, it's created (authority pays)"
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
      "name": "requestWithdrawal",
      "docs": [
        "Request withdrawal - burns wXMR and creates a withdrawal PDA"
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
    }
  ],
  "accounts": [
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
      "name": "invalidXmrAddress",
      "msg": "Invalid XMR address: must be 95 chars (standard/subaddress) or 106 chars (integrated), start with 4/8/9/A/B, and contain only base58 characters"
    },
    {
      "code": 6001,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6002,
      "name": "invalidMint",
      "msg": "Invalid mint"
    },
    {
      "code": 6003,
      "name": "invalidOwner",
      "msg": "Invalid owner"
    },
    {
      "code": 6004,
      "name": "invalidRecipient",
      "msg": "Invalid recipient"
    },
    {
      "code": 6005,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account - must be the correct ATA"
    },
    {
      "code": 6006,
      "name": "depositNotPending",
      "msg": "Deposit account is not in pending status"
    },
    {
      "code": 6007,
      "name": "depositNotActive",
      "msg": "Deposit account is not active"
    },
    {
      "code": 6008,
      "name": "addressAlreadyAssigned",
      "msg": "Deposit address already assigned"
    },
    {
      "code": 6009,
      "name": "depositTooSmall",
      "msg": "Deposit amount too small (minimum 0.01 XMR)"
    },
    {
      "code": 6010,
      "name": "withdrawalNotPending",
      "msg": "Withdrawal is not in pending status"
    },
    {
      "code": 6011,
      "name": "withdrawalAlreadyProcessed",
      "msg": "Withdrawal already processed (completed or sending)"
    },
    {
      "code": 6012,
      "name": "withdrawalCannotBeReverted",
      "msg": "Withdrawal cannot be reverted - already marked as sending (XMR may have been sent)"
    },
    {
      "code": 6013,
      "name": "withdrawalTooSmall",
      "msg": "Withdrawal amount too small (minimum 0.01 XMR)"
    },
    {
      "code": 6014,
      "name": "statisticsOverflow",
      "msg": "Overflow in statistics calculation"
    }
  ],
  "types": [
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
            "name": "xmrTxHash",
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
            "name": "xmrAddress",
            "type": "string"
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
            "type": "u64"
          },
          {
            "name": "xmrAddress",
            "type": "string"
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
