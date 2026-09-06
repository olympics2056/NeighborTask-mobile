# Render deployment

Application files, including package.json, are at the repository root.

- Root Directory: empty
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /api/app-health
- Main listener: Render PORT on 0.0.0.0
- Internal workflow listener: 127.0.0.1:3001 (not public)

For persistent pilot data, attach a disk at /var/data and set
NEIGHBORTASK_DATA_FILE=/var/data/neighbortask.json. Without a disk,
data is temporary and can disappear after redeployments.
Set SEED_DEMO=false for real pilot data. Demo data includes example verified helpers.

This release is an MVP for controlled testing. It does not provide actual identity
verification, insurance, payment processing, or a complete service booking workflow.
Claim confirmation is not identity proof. Discovery classification is rules-based.
Do not describe these capabilities as production-ready or insured services.
