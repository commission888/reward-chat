-- Multiple slip receivers per shop. Replaces the single slip_receiver_account_*
-- columns (0008) with a jsonb array so one shop can accept payment to several
-- accounts — notably KShop/merchant accounts (Slip2Go accountType 03000, matched
-- by the Merchant ID that Slip2Go returns as data.ref1), which a single
-- bank-account slot could not represent at all. Slip2Go's checkReceiver is an
-- array that matches if ANY entry matches, so listing every account here credits
-- a payment made to any one of them.
--
-- Each element: { "account_type": text, "account_number": text,
--                 "account_name_th": text|null, "account_name_en": text|null }
-- account_type is a Slip2Go code: a bank code (01002 = BBL, 01004 = KBANK, ...),
-- 03000 (K+ Shop / แม่มณี / Be Merchant), or 04000 (TrueMoney Wallet).

alter table public.shops
  add column slip_receivers jsonb not null default '[]'::jsonb;

-- Carry the existing single receiver (only GGWP has one configured) into the
-- array so no shop loses its account in the switch.
update public.shops
set slip_receivers = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'account_type', slip_receiver_account_type,
    'account_number', slip_receiver_account_number,
    'account_name_th', slip_receiver_account_name_th,
    'account_name_en', slip_receiver_account_name_en
  ))
)
where slip_receiver_account_type is not null
   or slip_receiver_account_number is not null;

alter table public.shops
  drop column slip_receiver_account_type,
  drop column slip_receiver_account_name_th,
  drop column slip_receiver_account_name_en,
  drop column slip_receiver_account_number;

comment on column public.shops.slip_receivers is
  'Array of Slip2Go checkReceiver conditions: {account_type, account_number, account_name_th, account_name_en}. A slip paid to ANY listed account is accepted. account_type is a bank code, 03000 (KShop/merchant), or 04000 (TrueMoney).';
