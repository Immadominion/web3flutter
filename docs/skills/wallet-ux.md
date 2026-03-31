# Wallet UX Patterns — Connection, Signing & Error States

> Design patterns for wallet connection flows, transaction approval UI, and error handling in Flutter Web3 apps.

## Overview

Wallet UX is where most Web3 apps lose users. A confusing connection flow or unclear error message sends people away. This guide covers proven patterns from production apps like Solflare, Espresso Cash, and others.

## Connection Flows

### Pattern 1: Embedded Wallet (Self-Custodial)

Best for: Payment apps, games, apps where users shouldn't need to think about wallets.

```dart
// Create wallet on first launch, user only sees seed phrase backup
class EmbeddedWalletService {
  final FlutterSecureStorage _storage;
  
  Future<Ed25519HDKeyPair> getOrCreateWallet() async {
    final existingMnemonic = await _storage.read(key: 'mnemonic');
    
    if (existingMnemonic != null) {
      return Ed25519HDKeyPair.fromMnemonic(existingMnemonic);
    }
    
    // Generate new wallet
    final mnemonic = bip39.generateMnemonic();
    await _storage.write(key: 'mnemonic', value: mnemonic);
    
    // Show backup prompt (don't block the user, but remind them)
    return Ed25519HDKeyPair.fromMnemonic(mnemonic);
  }
}
```

### Pattern 2: External Wallet Connection (MWA + WalletConnect)

Best for: DeFi apps, marketplaces, apps where users bring their own wallet.

```dart
// Connection state machine
enum WalletConnectionState {
  disconnected,
  connecting,
  connected,
  error,
}

class WalletConnectionNotifier extends StateNotifier<WalletConnectionState> {
  WalletConnectionNotifier() : super(WalletConnectionState.disconnected);
  
  String? connectedAddress;
  
  Future<void> connect() async {
    state = WalletConnectionState.connecting;
    
    try {
      if (Platform.isAndroid) {
        await _connectMWA();
      } else {
        await _connectWalletConnect();
      }
      state = WalletConnectionState.connected;
    } catch (e) {
      state = WalletConnectionState.error;
    }
  }
  
  Future<void> disconnect() async {
    // Clean up sessions
    connectedAddress = null;
    state = WalletConnectionState.disconnected;
  }
}
```

### Connection UI

```dart
// The connect button should clearly indicate:
// 1. Current state (connected / disconnected)
// 2. Which wallet / address is connected
// 3. How to disconnect

Widget buildWalletButton(WalletConnectionState state, String? address) {
  return switch (state) {
    WalletConnectionState.disconnected => ElevatedButton(
      onPressed: connect,
      child: Text('Connect Wallet'),
    ),
    WalletConnectionState.connecting => ElevatedButton(
      onPressed: null,
      child: Row(children: [
        SizedBox(width: 16, height: 16, child: CircularProgressIndicator()),
        SizedBox(width: 8),
        Text('Connecting...'),
      ]),
    ),
    WalletConnectionState.connected => GestureDetector(
      onTap: showWalletOptions, // Disconnect, copy address, etc.
      child: Chip(
        avatar: Jazzicon(address!),  // Deterministic avatar from address
        label: Text(shortenAddress(address)),
      ),
    ),
    WalletConnectionState.error => ElevatedButton(
      onPressed: connect,
      style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
      child: Text('Retry Connection'),
    ),
  };
}

String shortenAddress(String address) {
  return '${address.substring(0, 4)}...${address.substring(address.length - 4)}';
}
```

## Transaction Approval UI

### The Approval Screen

Every transaction should show a clear summary before the user signs:

```dart
class TransactionPreview extends StatelessWidget {
  final String action;          // "Send SOL", "Swap USDC → SOL"
  final String amount;          // "1.5 SOL"
  final String? recipient;      // Shortened address
  final String estimatedFee;    // "< 0.001 SOL"
  final VoidCallback onApprove;
  final VoidCallback onReject;
  
  Widget build(BuildContext context) {
    return BottomSheet(
      child: Column(
        children: [
          Text(action, style: headingStyle),
          AmountDisplay(amount),
          if (recipient != null) RecipientRow(recipient!),
          FeeRow(estimatedFee),
          Divider(),
          Row(children: [
            Expanded(child: OutlinedButton(
              onPressed: onReject,
              child: Text('Cancel'),
            )),
            SizedBox(width: 16),
            Expanded(child: ElevatedButton(
              onPressed: onApprove,
              child: Text('Confirm'),
            )),
          ]),
        ],
      ),
    );
  }
}
```

### Transaction Status States

```dart
enum TransactionStatus {
  building,     // Constructing the transaction
  simulating,   // Running simulation
  signing,      // Waiting for user/wallet signature
  sending,      // Submitted to network
  confirming,   // Waiting for confirmation
  confirmed,    // Success!
  failed,       // Transaction failed
}

// Show each state clearly
Widget buildStatusIndicator(TransactionStatus status) {
  return switch (status) {
    TransactionStatus.building => StatusChip('Preparing...', Colors.grey),
    TransactionStatus.simulating => StatusChip('Simulating...', Colors.blue),
    TransactionStatus.signing => StatusChip('Approve in wallet', Colors.orange),
    TransactionStatus.sending => StatusChip('Sending...', Colors.blue),
    TransactionStatus.confirming => StatusChip('Confirming...', Colors.amber),
    TransactionStatus.confirmed => StatusChip('Confirmed!', Colors.green),
    TransactionStatus.failed => StatusChip('Failed', Colors.red),
  };
}
```

## Error States

### User-Friendly Error Messages

```dart
String humanizeError(dynamic error) {
  final message = error.toString();
  
  if (message.contains('insufficient funds') || 
      message.contains('Insufficient funds')) {
    return 'Not enough SOL to complete this transaction. You need SOL for both the amount and the network fee.';
  }
  
  if (message.contains('Blockhash expired') || 
      message.contains('blockhash not found')) {
    return 'Transaction took too long. Please try again.';
  }
  
  if (message.contains('User rejected')) {
    return 'Transaction was cancelled.';
  }
  
  if (message.contains('simulation failed')) {
    return 'This transaction would fail. Please check your inputs and try again.';
  }
  
  if (message.contains('rate limit') || message.contains('429')) {
    return 'Network is busy. Please wait a moment and try again.';
  }
  
  // For unknown errors, show a generic message + the technical detail
  return 'Something went wrong. If this persists, contact support.';
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| No loading states during tx | Transactions take 2-30 seconds | Show clear progress through each stage |
| Raw error messages shown to user | Catching and displaying RPC errors directly | Map errors to human-friendly messages |
| No transaction history | Users can't verify past actions | Store signatures and show in-app history with Explorer links |
| Missing disconnect option | Only implementing connect | Always provide disconnect + switch wallet |
| No seed phrase backup reminder | Users skip backup on first launch | Periodic reminders until backup is confirmed |

## Related

- [Solana Mobile Stack](./solana-mobile.md) — MWA connection implementation
- [Solana Package Deep Dive](./solana-package.md) — Transaction building

---

*UX research from: Solflare, Espresso Cash, Phantom, Backpack*
