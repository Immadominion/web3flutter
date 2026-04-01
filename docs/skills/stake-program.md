# Stake Program — Native SOL Staking for Dart/Flutter

> Low-level instruction builders for the Solana Stake Program: account
> creation, delegation, deactivation, withdrawal, splitting, merging,
> authority management, and lockups. Built into the `solana` package.

| Package | Version | Pub |
|---------|---------|-----|
| `solana` | 0.31.2+ | [pub.dev](https://pub.dev/packages/solana) |

**Stake program support is built into the `solana` package** — import via
`package:solana/solana.dart`.

---

## Overview

The `solana` package provides 13 `StakeInstruction` factory constructors
plus 2 composite helpers covering the full Stake Program instruction set.
Stake account state is available via parsed RPC DTOs (`StakeProgramAccountData`,
`StakeMeta`, `Delegation`, etc.).

The Stake Program ID is `Stake11111111111111111111111111111111111111`.

---

## Quick Start

```dart
import 'package:solana/solana.dart';

Future<void> stakeDemo(SolanaClient client, Ed25519HDKeyPair funder) async {
  final stakeKeypair = await Ed25519HDKeyPair.random();
  final validatorVote = Ed25519HDPublicKey.fromBase58('Vote111...');
  final stakeConfig = Ed25519HDPublicKey.fromBase58(
    'StakeConfig11111111111111111111111111111111',
  );

  // 1. Create and initialize stake account
  final instructions = StakeInstruction.createAndInitializeAccount(
    fundingAccount: funder.publicKey,
    newAccount: stakeKeypair.publicKey,
    authorized: Authorized(
      staker: funder.address,
      withdrawer: funder.address,
    ),
    lamports: 2000000000, // 2 SOL
  );

  await client.sendAndConfirmTransaction(
    message: Message(instructions: instructions),
    signers: [funder, stakeKeypair],
    onSigned: ignoreOnSigned,
  );

  // 2. Delegate to validator
  final delegateIx = StakeInstruction.delegateStake(
    stake: stakeKeypair.publicKey,
    vote: validatorVote,
    config: stakeConfig,
    authority: funder.publicKey,
  );

  await client.sendAndConfirmTransaction(
    message: Message.only(delegateIx),
    signers: [funder],
    onSigned: ignoreOnSigned,
  );
}
```

---

## Core Concepts

### Program Constants

```dart
StakeProgram.programId;         // 'Stake11111111111111111111111111111111111111'
StakeProgram.id;                // Ed25519HDPublicKey
StakeProgram.neededAccountSpace; // 200 bytes (120 Meta + 72 Stake + padding)

// Stake Config (not provided by package — supply manually)
const stakeConfigId = 'StakeConfig11111111111111111111111111111111';
```

### Authorized (Staker + Withdrawer)

Every stake account has two authorities:

```dart
final authorized = Authorized(
  staker: stakerAddress,       // Can delegate, split, merge
  withdrawer: withdrawerAddress, // Can withdraw, close, change authorities
);
```

### Lockup

Optional time/epoch lock preventing withdrawal:

```dart
// No lockup (default)
const lockup = Lockup.none();

// Custom lockup
final lockup = Lockup(
  unixTimestamp: 1700000000,   // Unix timestamp
  epoch: 500,                  // Epoch number
  custodian: custodianAddress, // Can cancel lockup
);
```

### StakeAuthorize (Authority Selection)

```dart
// Change the staker authority
StakeAuthorize.staker(newStakerPubKey)

// Change the withdrawer authority
StakeAuthorize.withdrawer(newWithdrawerPubKey)
```

---

## Instruction Reference

### Account Lifecycle

#### Create and Initialize

```dart
// Composite helper — SystemInstruction.createAccount + StakeInstruction.initialize
final instructions = StakeInstruction.createAndInitializeAccount(
  fundingAccount: funder.publicKey,
  newAccount: stakeKeypair.publicKey,
  authorized: authorized,
  lamports: amountInLamports,
  lockup: const Lockup.none(),
);
// Sign with: [funder, stakeKeypair]
```

#### Create with Seed

```dart
// Derive address deterministically from base + seed
final stakeAddress = await Ed25519HDPublicKey.createWithSeed(
  fromPublicKey: funder.publicKey,
  seed: 'stake:0',
  programId: StakeProgram.id,
);

final instructions = StakeInstruction.createAndInitializeAccountWithSeed(
  fundingAccount: funder.publicKey,
  newAccount: stakeAddress,
  authorized: authorized,
  base: funder.publicKey,
  seed: 'stake:0',
  lamports: amountInLamports,
);
// Sign with: [funder] — no extra keypair needed
```

#### Initialize Only (Separate from Create)

```dart
final ix = StakeInstruction.initialize(
  stake: stakePubKey,
  authorized: authorized,
  lockup: const Lockup.none(),
);
```

#### Initialize Checked (Withdrawer Must Sign)

```dart
final ix = StakeInstruction.initializeChecked(
  stake: stakePubKey,
  stakeAuthority: stakerPubKey,
  withdrawAuthority: withdrawerPubKey,  // Must also sign the tx
);
```

### Delegation

```dart
final ix = StakeInstruction.delegateStake(
  stake: stakePubKey,
  vote: validatorVotePubKey,
  config: Ed25519HDPublicKey.fromBase58(stakeConfigId),
  authority: stakerPubKey,         // Staker authority signs
);
```

### Deactivation (Begin Unstaking)

```dart
final ix = StakeInstruction.deactivate(
  stake: stakePubKey,
  authority: stakerPubKey,
);
// Cooldown period: ~2-3 epochs (5-6 days)
```

### Withdrawal

```dart
final ix = StakeInstruction.withdraw(
  stake: stakePubKey,
  recipient: walletPubKey,
  authority: withdrawerPubKey,    // Withdrawer authority signs
  lamports: amountToWithdraw,
  lockupAuthority: lockupCustodian, // Required if locked
);
```

### Split

Split a stake account into two:

```dart
// First create the destination account
final destIx = SystemInstruction.createAccount(
  newAccount: destKeypair.publicKey,
  fundingAccount: funder.publicKey,
  lamports: 0,
  space: StakeProgram.neededAccountSpace,
  owner: StakeProgram.id,
);

final splitIx = StakeInstruction.split(
  sourceStake: sourcePubKey,
  destinationStake: destKeypair.publicKey,
  authority: stakerPubKey,
  amount: splitLamports,
);

// Sign with: [funder, destKeypair, staker]
```

### Merge

Merge two stake accounts into one (must have same authorities and
be delegated to the same validator or both inactive):

```dart
final ix = StakeInstruction.merge(
  sourceStake: sourceStakePubKey,    // Will be closed
  destinationStake: destStakePubKey, // Receives merged stake
  authority: stakerPubKey,
);
```

### Set Lockup

```dart
final ix = StakeInstruction.setLockup(
  stake: stakePubKey,
  authority: lockupCustodianPubKey,
  lockup: Lockup(
    unixTimestamp: newTimestamp,
    epoch: newEpoch,
    custodian: newCustodianAddress,
  ),
);
```

### Authority Changes

```dart
// Change staker
final ix = StakeInstruction.authorize(
  stake: stakePubKey,
  authority: currentStakerPubKey,
  authorize: StakeAuthorize.staker(newStakerPubKey),
);

// Change withdrawer
final ix = StakeInstruction.authorize(
  stake: stakePubKey,
  authority: currentWithdrawerPubKey,
  authorize: StakeAuthorize.withdrawer(newWithdrawerPubKey),
);

// Checked variant — new authority must also sign
final ix = StakeInstruction.authorizeChecked(
  stake: stakePubKey,
  authority: currentPubKey,
  stakeAuthorize: StakeAuthorize.staker(newPubKey),
);
```

---

## Account State DTOs

Query stake account state via `getAccountInfo` with `jsonParsed` encoding:

```dart
// Freezed union — discriminated by 'type' field
@Freezed(unionKey: 'type', fallbackUnion: 'unknown')
class StakeProgramAccountData {
  // Active delegation
  const factory StakeProgramAccountData.delegated({
    required StakeDelegatedAccountInfo info,
  });
  // Initialized but not yet delegated
  const factory StakeProgramAccountData.initialize({
    required StakeInitializedAccountInfo info,
  });
  // Unknown state
  const factory StakeProgramAccountData.unknown(Map<String, dynamic> info);
}
```

**Key fields in StakeMeta:**

```dart
class StakeMeta {
  Authorized authorized;    // staker + withdrawer addresses
  Lockup lockup;            // time/epoch/custodian lock
  String rentExemptReserve; // minimum SOL that cannot be withdrawn
}
```

**Key fields in Delegation:**

```dart
class Delegation {
  String voter;               // validator vote account
  String stake;               // delegated amount
  String activationEpoch;     // when delegation started
  String deactivationEpoch;   // when deactivation started
  double warmupCooldownRate;  // protocol parameter
}
```

### RPC Methods

```dart
// Get minimum delegation amount
final result = await rpcClient.getStakeMinimumDelegation();
final minLamports = result.value;  // int, typically 1 SOL
```

---

## Patterns & Recipes

### Full Staking Flow

```dart
Future<void> stakeToValidator({
  required SolanaClient client,
  required Ed25519HDKeyPair wallet,
  required String validatorVoteAddress,
  required int lamports,
}) async {
  final stakeKeypair = await Ed25519HDKeyPair.random();
  final votePubKey = Ed25519HDPublicKey.fromBase58(validatorVoteAddress);
  final config = Ed25519HDPublicKey.fromBase58(
    'StakeConfig11111111111111111111111111111111',
  );

  // Create + initialize + delegate in one transaction
  final instructions = [
    ...StakeInstruction.createAndInitializeAccount(
      fundingAccount: wallet.publicKey,
      newAccount: stakeKeypair.publicKey,
      authorized: Authorized(
        staker: wallet.address,
        withdrawer: wallet.address,
      ),
      lamports: lamports,
    ),
    StakeInstruction.delegateStake(
      stake: stakeKeypair.publicKey,
      vote: votePubKey,
      config: config,
      authority: wallet.publicKey,
    ),
  ];

  await client.sendAndConfirmTransaction(
    message: Message(instructions: instructions),
    signers: [wallet, stakeKeypair],
    onSigned: ignoreOnSigned,
  );
}
```

### Unstake and Withdraw

```dart
Future<void> unstakeAndWithdraw({
  required SolanaClient client,
  required Ed25519HDKeyPair wallet,
  required Ed25519HDPublicKey stakeAccount,
  required int lamports,
}) async {
  // 1. Deactivate — starts cooldown
  await client.sendAndConfirmTransaction(
    message: Message.only(StakeInstruction.deactivate(
      stake: stakeAccount,
      authority: wallet.publicKey,
    )),
    signers: [wallet],
    onSigned: ignoreOnSigned,
  );

  // 2. Wait ~2-3 epochs for cooldown to complete ...

  // 3. Withdraw
  await client.sendAndConfirmTransaction(
    message: Message.only(StakeInstruction.withdraw(
      stake: stakeAccount,
      recipient: wallet.publicKey,
      authority: wallet.publicKey,
      lamports: lamports,
    )),
    signers: [wallet],
    onSigned: ignoreOnSigned,
  );
}
```

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Trying to withdraw before deactivation cooldown completes | Deactivation takes ~2-3 epochs (5-6 days) — check activation state before withdrawing |
| 2 | Missing the `stakeConfig` parameter in `delegateStake` | Supply `StakeConfig11111111111111111111111111111111` — the package doesn't provide this constant |
| 3 | Not signing with both funder AND stake keypair on creation | `createAndInitializeAccount` requires both signers: `[funder, stakeKeypair]` |
| 4 | Using staker authority to withdraw — wrong authority type | Withdrawal requires the **withdrawer** authority, not the staker |
| 5 | Trying to merge stake accounts delegated to different validators | Both accounts must be delegated to the same validator (or both inactive) to merge |
| 6 | Splitting below minimum delegation | Check `getStakeMinimumDelegation()` — both resulting accounts must meet the minimum |
| 7 | Forgetting to create the destination account before splitting | `split` needs an existing account owned by the Stake Program with 200 bytes of space |
| 8 | Not accounting for `rentExemptReserve` in withdrawal amounts | Some SOL is locked as rent — `StakeMeta.rentExemptReserve` shows the minimum |

---

## Related

- [solana-core.md](solana-core.md) — RPC client, SystemInstruction, transaction signing
- [transaction-building.md](transaction-building.md) — composing multi-instruction staking transactions
