-- Cash is collected rounded UP to a whole shekel. The surplus is its own ledger component and is held
-- by a dedicated platform account. New enum values are added in their own migration so they are
-- committed before the next one uses them.
ALTER TYPE "EarningComponent" ADD VALUE 'CASH_ROUNDING';
ALTER TYPE "PartnerAccountKind" ADD VALUE 'PLATFORM_ACCOUNT';
