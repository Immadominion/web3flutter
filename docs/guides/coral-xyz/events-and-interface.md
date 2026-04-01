# Events & Program Interface — Log Parsing and Manual IDL Definition

> How `coral_xyz` decodes program events from transaction logs, and how to define IDLs by hand for programs that don't ship one.

## Overview

This page covers two distinct features that share a common thread — they both handle cases where the standard "load IDL → call program" flow isn't enough:

1. **Events** — Programs emit structured data in transaction logs. `coral_xyz` subscribes to these logs via WebSocket, parses them in real-time, and delivers decoded events to your callbacks.
2. **ProgramInterface.define()** — For programs that don't publish an IDL (native Rust programs, Pinocchio without Codama, or proprietary programs), you can hand-define one using a builder API.

---

## Events

### How Solana Program Events Work

Unlike Ethereum, Solana has no first-class event system. Programs "emit" events by writing structured data to transaction logs via `msg!()` or Anchor's `emit!()` macro. The data is base64-encoded and prefixed with `"Program data: "` in the log output.

To read events, a client must:

1. Subscribe to transaction logs for a specific program
2. Parse each log line to find `"Program data: "` entries
3. Base64-decode the data
4. Match the discriminator to identify which event type it is
5. Deserialize the remaining bytes according to the event's field layout

`coral_xyz` handles all of this.

### Quick Start

```dart
import 'package:coral_xyz/coral_xyz.dart';

final program = Program(idl, provider: provider);

// Subscribe to a specific event type
final listenerId = program.events.addEventListener<Map<String, dynamic>>(
  'TransferEvent',
  (event, slot, signature) {
    print('Transfer: ${event['amount']} from ${event['from']}');
    print('Slot: $slot, Signature: $signature');
  },
);

// Later — unsubscribe
await program.events.removeEventListener(listenerId);

// When done — clean up all subscriptions
await program.events.dispose();
```

### EventManager Internals

`EventManager` manages the WebSocket lifecycle:

```dart
class EventManager {
  int addEventListener<T>(String eventName, EventCallback<T> callback, {CommitmentConfig? commitment});
  Future<void> removeEventListener(int listener);
  Future<void> dispose();

  EventStats get stats;
  WebSocketState get state;
}
```

The first `addEventListener` call starts a WebSocket subscription via `connection.onLogs(programId)`. Subsequent listeners piggyback on the same connection. When the last listener is removed, the WebSocket is torn down.

Each listener gets a numeric ID (TypeScript API parity). The callback receives three arguments:

- `event` — the decoded event data (`Map<String, dynamic>`)
- `slot` — the slot number where the transaction was confirmed
- `signature` — the transaction signature

### Event Discriminators

Events use the same SHA256 scheme as instructions and accounts:

- **Anchor**: `SHA256("event:{EventName}")[0..8]`
- **Quasar**: explicit discriminator from the IDL, prefixed with `0xFF`

The `0xFF` prefix on Quasar event discriminators prevents collisions with instruction or account discriminators. This is validated by `DiscriminatorComputer.validateExplicitDiscriminator()` — instruction and account discriminators are rejected if their first byte is `0xFF`.

### EventParser — Log Parsing Algorithm

The real complexity is in `EventParser.parseLogs()`, which handles Solana's CPI (Cross-Program Invocation) log format:

```dart
class EventParser {
  const EventParser(PublicKey programId, Coder coder);

  Iterable<Event<IdlEvent, dynamic>> parseLogs(
    List<String> logs, {bool errorOnDecodeFailure = false}
  ) sync*;
}
```

The parser maintains a stack-based execution context:

1. **Log scan**: Iterates all log lines starting with `"Program "`
2. **Context tracking**: `"Program <id> invoke [N]"` pushes a new execution context. `"Program <id> success"` pops it.
3. **Event extraction**: When the current context matches the target program ID, the parser looks for:
   - `"Program log: "` — text log (ignored for events)
   - `"Program data: "` — base64-encoded event data → decode
4. **CPI handling**: When program A calls program B, log lines from B appear between A's logs. The stack tracks whose logs we're currently parsing.

> **WHY THIS MATTERS**: Quasar programs emit events via self-CPI (`emit_cpi!` macro). This means the event log appears inside a nested `"Program <id> invoke [2]"` block where the program invokes itself. The parser detects this — when a `Program invoke` matches the target program ID at depth > 1, it recognizes the self-CPI pattern and still decodes the event.

### Event Parsing Example

Raw transaction logs from a program that emits a `DepositEvent`:

```
Program 11111111111111111111111111111111 invoke [1]
Program log: Instruction: Deposit
Program data: <base64-encoded event>
Program 11111111111111111111111111111111 success
```

The parser:

1. Sees `invoke [1]` → pushes program ID to context stack
2. Sees `Program data:` → current context is our program → decode
3. Base64-decodes → checks discriminator against all known events
4. Finds `DepositEvent` match → Borsh-decodes fields → yields `Event` object
5. Sees `success` → pops context

---

## ProgramInterface.define()

### When You Need It

Not every Solana program has an IDL. Native Rust programs, early Pinocchio programs, or proprietary programs often don't publish one. `ProgramInterface.define()` lets you create an IDL from scratch using a fluent builder API.

The resulting `Idl` object works identically to one loaded from JSON — same `Program` constructor, same namespaces, same coders.

### Quick Start

```dart
import 'package:coral_xyz/coral_xyz.dart';

final idl = ProgramInterface.define(
  name: 'token_vault',
  address: 'VaultProgramAddress11111111111111111',
  version: '1.0.0',
)
  // Define an instruction
  .instruction('deposit', discriminator: [1])
    .account('vault', writable: true)
    .account('depositor', signer: true)
    .account('systemProgram')
    .arg('amount', 'u64')
    .done()

  // Define an instruction with no args
  .instruction('withdraw', discriminator: [2])
    .account('vault', writable: true)
    .account('authority', signer: true)
    .done()

  // Define an account type
  .account('Vault', discriminator: [0])
    .field('authority', 'pubkey')
    .field('balance', 'u64')
    .field('bump', 'u8')
    .done()

  // Define a custom type (used in args or accounts)
  .type('VaultConfig')
    .field('maxDeposit', 'u64')
    .field('paused', 'bool')
    .doneAsStruct()

  // Define an enum type
  .type('VaultStatus')
    .variant('Active')
    .variant('Paused')
    .variant('Closed', fields: [{'name': 'reason', 'type': 'string'}])
    .doneAsEnum()

  // Define custom errors
  .error(6000, 'InsufficientFunds', msg: 'Not enough SOL in the vault')
  .error(6001, 'Unauthorized', msg: 'Signer is not the vault authority')

  .build();

// Use it exactly like any other IDL
final program = Program(idl, provider: provider);
final sig = await program.methods['deposit']!([BigInt.from(1000000000)])
    .accounts({'vault': vaultAddress, 'depositor': wallet.publicKey})
    .rpc();
```

### Builder API Reference

```
ProgramInterface.define(name, address?, version?)
  │
  ├── .instruction(name, discriminator?)
  │     ├── .account(name, {writable, signer, optional})  → self
  │     ├── .arg(name, type)                                → self
  │     └── .done()                                         → back to parent
  │
  ├── .account(name, discriminator?)
  │     ├── .field(name, type)                              → self
  │     └── .done()                                         → back to parent
  │
  ├── .type(name)
  │     ├── .field(name, type)                              → self (struct field)
  │     ├── .variant(name, {fields?})                       → self (enum variant)
  │     ├── .doneAsStruct()                                 → back to parent
  │     ├── .doneAsEnum()                                   → back to parent
  │     └── .done()                                         → auto-detects struct vs enum
  │
  ├── .event(name, discriminator?)                          → self
  ├── .error(code, name, {msg?})                            → self
  └── .build()                                              → Idl
```

### Type Strings

The `type` parameter in `.arg()` and `.field()` accepts either a string or a map:

| Input | Meaning |
|-------|---------|
| `'u8'` | unsigned 8-bit integer |
| `'u64'` | unsigned 64-bit integer |
| `'pubkey'` | 32-byte public key |
| `'string'` | length-prefixed UTF-8 string |
| `'bool'` | boolean |
| `{'vec': 'u8'}` | vector of u8 |
| `{'option': 'pubkey'}` | optional public key |
| `{'array': ['u8', 32]}` | fixed-length array of 32 bytes |
| `{'defined': 'VaultConfig'}` | reference to a defined type |

### How It Routes to Zero-Copy

`build()` produces JSON and calls `Idl.fromJson()`. The generated JSON includes `metadata.spec = 'manual'`, which triggers `IdlFormat.detect()` to return `IdlFormat.manual`. This routes account decoding to `ZeroCopyAccountsCoder`.

> **CRITICAL**: Because manual IDLs use zero-copy decoding, your field definitions must match the exact on-chain byte layout. Field order matters. Field sizes matter. If the program writes `authority` (32 bytes) then `count` (8 bytes), your `.field()` calls must be in that exact order. Adding an extra field or swapping order means the byte offsets are wrong and every field after the mismatch reads garbage.

### Account Definition Side Effect

When you call `.account('Counter', discriminator: [0]).field(...).done()`, the builder adds the type definition to both the `accounts` list AND the `types` list. This is necessary because the `AccountsCoder` looks up field definitions in `types` by name. Without this, account decoding wouldn't know the field layout.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Event listener fires but data is null | Event discriminator doesn't match — Quasar events need `0xFF` prefix | Check IDL event discriminators match what the program actually emits |
| Events from CPI calls are missed | Parser doesn't see them because the program ID doesn't match in the log context | This should work for self-CPI — if it's a different program's event, subscribe to that program's logs |
| `ProgramInterface` field order mismatch | Fields defined in wrong order vs on-chain layout | Read the Rust source to verify field order. `repr(C)` structs have fields in declaration order |
| Manual IDL account data is garbage | Wrong discriminator length — e.g., IDL says `[0]` (1 byte) but program uses 8-byte SHA256 | Match the discriminator to what the program actually writes |
| `addEventListener` returns but callback never fires | No matching events emitted, or WebSocket not connected | Check `program.events.state` for WebSocket status. Verify the program actually emits events in the operation you're testing |

---

## Related

- [coral_xyz Overview](.) — Architecture and quick start
- [IDL Deep Dive](idl-basics) — Discriminator computation, type system
- [Serialization](serialization) — Borsh and zero-copy encoding details
