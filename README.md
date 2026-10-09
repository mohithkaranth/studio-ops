This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Payment reconciliation preview

Open **Payment Reconciliation** in the sidebar, load up to 31 days of booking dates, then check processor payments. Existing `DATABASE_URL`, `ACUITY_USER_ID`, and `ACUITY_API_KEY` server environment variables are required. No additional Stripe key or database migration is needed for this preview.

Acuity's [appointment payments endpoint](https://developers.acuityscheduling.com/reference/get-appointments-id-payments) supplies processor transaction IDs, dates and amounts. These are Acuity records, not a live Stripe refund or payout audit. The preview does not write payment statuses, alter revenue reports, or confirm bank matches.

PayNow suggestions require SGD credits labeled PayNow, an exact outstanding amount, and the complete customer name or appointment ID. Payment dates must fall between booking creation (or 30 days before the appointment when creation is unknown) and seven days after the appointment. Search covers uploaded statements only. Canceled bookings, certificate redemptions and negative processor adjustments require separate review. Ambiguity is checked within the selected booking range; all suggestions still require human review, including possible matches to bookings outside that range. Stripe bank payouts are excluded from PayNow candidates to avoid counting the processor payment again.

Processor lookups run three at a time; failed lookups remain unknown and can be retried. Select a smaller range for more than 500 bookings or 10,000 bank credits. No missing or failed lookup is interpreted as unpaid.

Run matching tests with Node 22.6+:

```bash
node --experimental-strip-types --test tests/payment-reconciliation.test.mjs
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
