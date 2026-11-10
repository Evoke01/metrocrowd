# MetroCrowd rewards setup

The rewards program is shipped disabled. Configure and review it before enabling cash payouts.

## 1. Add the database objects

Run `migrations/20261110_referral_rewards.sql` once in the Supabase SQL editor. It adds the reward ledger, referral attribution, payout request tables, and the trip path data used to validate a completed route.

## 2. Configure the Render API

Add `REWARDS_ADMIN_USER_IDS` to the `metrocrowd-api` web service. Set it to the Supabase Auth UUID of the account that will review payouts. Multiple admin UUIDs can be comma-separated. Find the UUID in Supabase Authentication → Users. Do not use an email address as the admin credential.

The API validates each access token through Supabase Auth and uses the existing server-side `SUPABASE_KEY`. Never expose that key in the browser.

## 3. Configure rewards in the app

Sign in with the admin account, open **Account → Rewards points & referrals**, and review the settings. The initial values are examples: 10 points per completed commute, 50 points for the referrer after a friend's first completed commute, 1,000 points minimum, and ₹10 per 1,000 points. Edit them to fit the reward budget before turning on **Enable live earning and payout requests**.

## 4. Review payout requests

Users need a signed-in account. Their invite link carries a referral code. The referrer earns points only after the new user signs in and completes a verified route. Every eligible completed commute can also earn commute points.

Payout requests reserve points and show the user's UPI ID to the admin. Approve or reject a request in the admin panel. A rejected request refunds the points. For an approved request, send the UPI payment manually, then mark it paid and enter the transaction reference. No transfer is initiated by MetroCrowd.

## Before opening the program

Review the cash conversion, payout minimum, fraud handling, privacy disclosures, and applicable Indian payment and tax requirements. The app's completion checks require an authenticated user and sequential station events, but client GPS can still be spoofed; manual review remains important. The migration and code do not activate rewards until an admin enables them.
