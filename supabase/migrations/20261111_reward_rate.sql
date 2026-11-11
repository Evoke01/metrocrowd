-- Payout rate: 1,000 points = Rs 100 (100 points = Rs 10).
update public.reward_settings
set rupees_per_1000_points = 100.00, updated_at = now()
where singleton;
