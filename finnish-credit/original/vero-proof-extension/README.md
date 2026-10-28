# Fairway Vero Debt-Free Proof Extension

Local demo extension for the Positive Credit Register e-service.

## Load

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select this `vero-proof-extension/` folder

## Demo Flow

1. Open the dApp at `http://127.0.0.1:5173`
2. Connect Phantom
3. Select `PROD`
4. Click **Start Vero Proof Session**
5. Sign in to Vero and open **Loan information**
6. Wait for the overlay to say `Vero /loans response captured`
7. Click **Create debt-free proof**
8. Close the Vero tab when it says published

This is a browser-capture demo helper. It is not yet a cryptographic TLSNotary
proof.
