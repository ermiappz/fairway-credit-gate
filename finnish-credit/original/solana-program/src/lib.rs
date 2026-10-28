use anchor_lang::prelude::*;

declare_id!("8r3EJCaFuJHxxbUK2uWdPhWetjk6trzPhZ4tEaRAwL4L");

#[program]
pub mod fi_credit_attestation {
    use super::*;

    /// Called by the verifier server after checking the Vero/TLSNotary proof.
    /// The verifier signs and pays for the tx. Wallet is only a PDA seed here.
    pub fn attest_credit(
        ctx: Context<AttestCredit>,
        risk_flags: u32,
        proof_hash: [u8; 32],
        notary_pubkey: [u8; 32],
        attested_at: i64,
    ) -> Result<()> {
        require!(risk_flags == 0, CreditError::HasCreditRiskFlags);

        let attestation = &mut ctx.accounts.attestation;
        attestation.wallet = ctx.accounts.wallet.key();
        attestation.risk_flags = risk_flags;
        attestation.proof_hash = proof_hash;
        attestation.notary_pubkey = notary_pubkey;
        attestation.attested_at = attested_at;
        attestation.expires_at = attested_at + 30 * 24 * 60 * 60; // 30 days
        attestation.verifier = ctx.accounts.verifier.key();
        attestation.revoked = false;
        attestation.bump = ctx.bumps.attestation;

        emit!(AttestationCreated {
            wallet: attestation.wallet,
            risk_flags,
            attested_at,
            expires_at: attestation.expires_at,
        });

        msg!(
            "Credit attestation created: wallet={} risk_flags={} expires={}",
            attestation.wallet,
            risk_flags,
            attestation.expires_at
        );

        Ok(())
    }

    pub fn revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        attestation.revoked = true;

        emit!(AttestationRevoked {
            wallet: attestation.wallet,
        });

        Ok(())
    }

    pub fn check_attestation(ctx: Context<CheckAttestation>) -> Result<()> {
        let attestation = &ctx.accounts.attestation;
        let clock = Clock::get()?;

        let valid = !attestation.revoked
            && attestation.risk_flags == 0
            && clock.unix_timestamp < attestation.expires_at;

        msg!(
            "Attestation check: valid={} risk_flags={} expires={}",
            valid,
            attestation.risk_flags,
            attestation.expires_at
        );

        Ok(())
    }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AttestCredit<'info> {
    /// The verifier server keypair — signs and pays for the attestation.
    #[account(mut)]
    pub verifier: Signer<'info>,

    /// CHECK: wallet pubkey is only used as a PDA seed; it does not sign here.
    /// The verifier has already off-chain accepted the zero-risk-flag Vero
    /// credit-register extract for this wallet. Production deployments should
    /// bind the wallet/challenge into the TLS transcript.
    pub wallet: UncheckedAccount<'info>,

    /// The attestation PDA — one per wallet. Created if missing, reused if present.
    #[account(
        init_if_needed,
        payer = verifier,
        space = CreditAttestation::SPACE,
        seeds = [b"credit_attestation", wallet.key().as_ref()],
        bump,
    )]
    pub attestation: Account<'info, CreditAttestation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub verifier: Signer<'info>,

    #[account(
        mut,
        seeds = [b"credit_attestation", attestation.wallet.as_ref()],
        bump = attestation.bump,
        has_one = verifier @ CreditError::UnauthorizedVerifier,
    )]
    pub attestation: Account<'info, CreditAttestation>,
}

#[derive(Accounts)]
pub struct CheckAttestation<'info> {
    #[account(
        seeds = [b"credit_attestation", wallet.key().as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, CreditAttestation>,

    /// CHECK: only used to derive the PDA seed.
    pub wallet: UncheckedAccount<'info>,
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
pub struct CreditAttestation {
    pub wallet: Pubkey,
    pub risk_flags: u32,
    pub proof_hash: [u8; 32],
    pub notary_pubkey: [u8; 32],
    pub verifier: Pubkey,
    pub attested_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

impl CreditAttestation {
    pub const SPACE: usize = 8 + 32 + 4 + 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[event]
pub struct AttestationCreated {
    pub wallet: Pubkey,
    pub risk_flags: u32,
    pub attested_at: i64,
    pub expires_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub wallet: Pubkey,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum CreditError {
    #[msg("Wallet has Vero Positive Credit Register risk flags — cannot attest")]
    HasCreditRiskFlags,
    #[msg("Only the original verifier can revoke an attestation")]
    UnauthorizedVerifier,
}
