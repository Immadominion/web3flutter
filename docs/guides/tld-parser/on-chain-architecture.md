# On-Chain Architecture — Three Programs, One Domain System

> The AllDomains protocol isn't one Solana program. It's three programs working together: ANS stores names, TLD House governs TLDs, and Name House wraps domains as NFTs.

## Overview

When you register `miester.abc` on AllDomains, you're not just writing data to one account. You're interacting with a system of accounts spread across three programs, each with a different job. Understanding this architecture explains why the SDK has separate PDA derivation functions for TLD houses, name houses, and name accounts — and why resolving an NFT-wrapped domain requires reading accounts from all three.

This page maps out what those programs are, what accounts they create, and how they relate to each other.

## The Three Programs

### ANS — The Name Registry

**Program ID**: `ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK`

This is the core name service. It owns all name account data — every domain, subdomain, record, and TLD account. If a domain exists, its data lives in an account owned by this program.

ANS is responsible for:

- Storing name-to-owner mappings (NameRecordHeader accounts)
- Maintaining the domain hierarchy (parent → child relationships)
- Recording expiration and creation timestamps
- Holding record data (Twitter handles, Ethereum addresses, etc.)

ANS looks structurally similar to Bonfida's SPL Name Service. The key difference: it uses the hash prefix `ALT Name Service` instead of `SPL Name Service`, which means every PDA derived for ANS domains is in a completely separate address space from SNS domains. They cannot collide.

### TLD House — TLD Governance

**Program ID**: `TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S`

Each TLD (`.abc`, `.skr`, `.bonk`, etc.) has a TLD House account that configures how that TLD operates. The TLD House program manages:

- TLD House accounts — one per TLD, storing configuration
- TLD House Treasuries — fee collection for domain registrations
- Main Domain accounts — tracking which domain a user has set as their primary identity
- Claimable Domain accounts — domains available for registration

The TLD House program is also what makes custom main domains possible. When a user calls "set as main domain" in their wallet, the TLD House program creates a MainDomain account keyed to the user's wallet address.

### Name House — NFT Wrapping

**Program ID**: `NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51`

Name House is the bridge between the name service and Solana's NFT ecosystem. When a user "wraps" their domain as an NFT:

1. Name House creates an NFT mint with the domain name as metadata
2. It creates an NftRecord account that links the domain to the NFT
3. The domain's owner field in ANS is updated to point at the NftRecord (not the user's wallet)
4. The user receives the NFT token in their wallet

This is why ownership resolution in the SDK isn't a simple `nameRecord.owner` read. For NFT-wrapped domains, the owner field points to an NftRecord, and you need to trace through the NFT mint to the actual token holder.

> **WHY THIS MATTERS**: If you read a NameRecordHeader and the owner is not a recognizable wallet address, it's probably pointing at an NftRecord PDA. The SDK handles this transparently in `getOwnerFromDomainTld()`, but if you're doing manual account reads, you'll get the wrong owner without the extra NFT resolution step.

## The Account Hierarchy

Every domain in ANS exists in a strict hierarchy. Understanding this hierarchy is essential for PDA derivation.

```
Origin TLD Key (3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU)
│
├── TLD Account (.abc)
│   ├── Domain Account (miester)
│   │   ├── Subdomain Account (vault.miester.abc)
│   │   │   └── Sub-record Account (Twitter.vault.miester.abc)
│   │   └── Record Account (Twitter.miester.abc)
│   └── Domain Account (heisjoel)
│       └── ...
│
├── TLD Account (.skr)
│   ├── Domain Account (heisjoel)
│   └── ...
│
└── TLD Account (.bonk)
    └── ...
```

### The Origin TLD Key

At the root of the hierarchy is the Origin TLD Key: `3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU`.

This key is derived by hashing the string `ANS` with the `ALT Name Service` prefix:

```dart
import 'package:tld_parser/tld_parser.dart';

// This is how the origin key is computed (you don't need to do this yourself)
final hashedOrigin = getHashedName('ANS');
final (originKey, _) = await getNameAccountKey(hashedName: hashedOrigin);
// originKey == Ed25519HDPublicKey.fromBase58('3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU')
```

Every TLD account is derived with the Origin TLD Key as its parent. This is what makes the hierarchy a tree — each level knows its parent.

### TLD Accounts

A TLD account is a NameRecordHeader owned by ANS. Its parent is the Origin TLD Key. Its name is the TLD string with a leading dot (`.abc`, `.skr`).

The TLD account's `owner` field points to the TLD House account for that TLD. This link is how the SDK navigates from a domain string to the TLD House configuration.

### Domain Accounts

A domain account is a NameRecordHeader owned by ANS. Its parent is the TLD account. Its name is the domain label (`miester`, `heisjoel`).

The domain account's `owner` field is either:

- The wallet address of the domain owner (direct ownership)
- The NftRecord PDA for the domain (NFT-wrapped ownership)

### Subdomain and Record Accounts

Subdomains and records are also NameRecordHeader accounts, but with a key difference: they use a prefix byte to distinguish between the two.

- **Subdomains** are derived with prefix `\x00` before the label
- **Records** are derived with prefix `\x01` before the label

So the name account for `vault.miester.abc` (subdomain) is derived from `\x00vault` with parent = `miester`'s name account. The name account for `Twitter.miester.abc` (record) is derived from `\x01Twitter` with the same parent.

This prefix scheme is what prevents collision between a subdomain called `Twitter` and a record called `Twitter` on the same domain.

## Per-TLD Infrastructure

Each TLD has its own constellation of accounts managed by TLD House and Name House:

```
TLD: .abc
│
├── TLD House Account
│   ├── TLD House Treasury
│   └── TLD State PDA
│
├── Name House Account
│   ├── Collection Mint (NFT collection for .abc domains)
│   └── Per-domain NFT infrastructure:
│       ├── NFT Record Account
│       ├── NFT Mint Account
│       └── Metaplex Metadata Account
│
└── Main Domain Accounts (per-user, not per-TLD)
```

### TLD House Accounts

A TLD House account stores configuration for a TLD. In the SDK, you derive it like this:

```dart
final (tldHouse, bump) = await findTldHouse('abc');
// Seeds: ["tld_house", ".abc"] → programId: TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S
```

The TLD House data contains (at known byte offsets):

- Authority pubkey (who manages this TLD)
- Mint account reference
- Parent account pointer (the TLD's name account in ANS)
- TLD string (length-prefixed at offset 104)

### Name House Accounts

Each TLD House has a corresponding Name House that handles NFT wrapping:

```dart
final (tldHouse, _) = await findTldHouse('abc');
final (nameHouse, bump) = await findNameHouse(tldHouse);
// Seeds: ["name_house", tldHouse.bytes] → programId: NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51
```

The Name House is the entity that mints domain NFTs. Its address appears as the `verified creator` in Metaplex metadata, which is how the SDK identifies which NFTs are AllDomains domain NFTs when scanning a user's token accounts.

### Main Domain Accounts

Main Domain accounts are special — they're keyed to the *user*, not the domain:

```dart
final (mainDomainPda, bump) = await findMainDomain(userPubkey);
// Seeds: ["main_domain", userPubkey.bytes] → programId: TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S
```

A MainDomain account stores which domain a user has chosen as their primary identity. It contains the name account pubkey, the TLD string, and the domain label. This is what reverse resolution reads — given a wallet address, derive the MainDomain PDA and read what's stored there.

> **GOTCHA**: A user can only have one main domain. If they own `miester.abc` and `heisjoel.skr`, only one can be the main domain. The SDK's `getMainDomain()` returns whichever was most recently set, regardless of TLD.

## How the Programs Interact

Here's the full journey when someone calls `parser.getOwnerFromDomainTld('miester.abc')`:

1. **Split** the input: domain = `miester`, tld = `.abc`
2. **Derive the TLD parent** — hash `.abc` with the `ALT Name Service` prefix, derive PDA with Origin TLD Key as parent. This gives the TLD account address (ANS program).
3. **Derive the domain account** — hash `miester`, derive PDA with TLD account as parent. This gives the domain's NameRecordHeader address (ANS program).
4. **Fetch the NameRecordHeader** from the ANS program at that address.
5. **Check validity** — is the domain expired? Is there an owner?
6. **Derive the TLD House** — seeds `["tld_house", ".abc"]` on the TLD House program.
7. **Derive the Name House** — seeds `["name_house", tldHouse.bytes]` on the Name House program.
8. **Derive the NFT Record** — seeds `["nft_record", nameHouse.bytes, domainAccount.bytes]` on the Name House program.
9. **Compare** — if `nameRecord.owner == nftRecordPDA`, the domain is NFT-wrapped.
10. **If wrapped**: Fetch the NftRecord, get the NFT mint, find the largest token holder of that mint, read the token account's owner field. That's the real owner.
11. **If not wrapped**: `nameRecord.owner` is the real owner.

That's six potential RPC calls for a single domain resolution. The SDK batches these when possible, but the fundamental cost is the three-program architecture.

## Program ID Quick Reference

| Program | ID | Purpose |
|---------|----|----- |
| ANS | `ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK` | Name registry — all domain accounts |
| TLD House | `TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S` | TLD governance, main domains |
| Name House | `NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51` | NFT wrapping for domains |
| Origin TLD Key | `3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU` | Root of the TLD hierarchy |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Token program (NFT mints) |
| Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | Metaplex NFT metadata |

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using `SPL Name Service` as hash prefix | Copying code from SNS/Bonfida examples | Always use `ALT Name Service` — it's in `constants.dart` as `hashPrefix` |
| Reading `nameRecord.owner` as the domain owner | Works for non-wrapped domains | Use `getOwnerFromDomainTld()` which handles NFT resolution automatically |
| Looking up TLD House with `findTldHouse('.abc')` and `findTldHouse('abc')` and getting different results | Inconsistent dot prefix | Both work — `findTldHouse` normalizes the input. But if you hash manually, include the dot |
| Forgetting that expired domains have null owners | The SDK sets `owner = null` for expired domains | Check `isValid` before using the owner, or handle `null` |

## Related

- [PDA Derivation](pda-derivation.md) — How every address in this hierarchy is computed
- [State & Deserialization](state-and-deserialization.md) — Byte layouts for each account type
- [Resolution & Records](resolution-and-records.md) — The full resolution algorithm in detail
