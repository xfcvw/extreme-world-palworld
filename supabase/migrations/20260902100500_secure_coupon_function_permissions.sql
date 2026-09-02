revoke all on function public.coupon_quote_for_user(text, uuid, integer) from anon, authenticated;
revoke all on function public.reserve_coupon_for_order(text, uuid, uuid, integer) from anon, authenticated;
revoke all on function public.finalize_coupon_redemption(uuid, boolean) from anon, authenticated;
revoke all on function public.release_coupon_reservation(uuid) from anon, authenticated;
grant execute on function public.coupon_quote_for_user(text, uuid, integer) to service_role;
grant execute on function public.reserve_coupon_for_order(text, uuid, uuid, integer) to service_role;
grant execute on function public.finalize_coupon_redemption(uuid, boolean) to service_role;
grant execute on function public.release_coupon_reservation(uuid) to service_role;
