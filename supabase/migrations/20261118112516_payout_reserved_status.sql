-- Новое значение enum фиксируется отдельной транзакцией до использующей его миграции.
alter type public.payout_status add value if not exists 'reserved' before 'paid';
