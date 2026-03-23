-- Replace literal RLS true with auth-scoped expressions (linter 0013 rls_policy_always_true).

ALTER POLICY "Users can delete accessories for their business" ON public.accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can insert accessories for their business" ON public.accessories
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can update accessories for their business" ON public.accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text))) WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can view accessories for their business" ON public.accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable all access for authenticated users" ON public.ads_history
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable delete access for authenticated users" ON public.ai_keys
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable insert access for authenticated users" ON public.ai_keys
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable read access for authenticated users" ON public.ai_keys
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable update access for authenticated users" ON public.ai_keys
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable delete access for authenticated users" ON public.ai_models
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable insert access for authenticated users" ON public.ai_models
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable read access for authenticated users" ON public.ai_models
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable update access for authenticated users" ON public.ai_models
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Authenticated read ameex_cities" ON public.ameex_cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow all for authenticated" ON public.business_payments
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated read" ON public.businesses
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read cities" ON public.cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read coliaty_cities" ON public.coliaty_cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can manage company delivery notes" ON public.company_delivery_notes
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.company_fees
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can manage company parcels" ON public.company_parcels
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Users can delete company_payment_note_orders for their business" ON public.company_payment_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can insert company_payment_note_orders for their business" ON public.company_payment_note_orders
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can update company_payment_note_orders for their business" ON public.company_payment_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can view company_payment_note_orders for their business" ON public.company_payment_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can delete company_payment_notes for their business" ON public.company_payment_notes
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can insert company_payment_notes for their business" ON public.company_payment_notes
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can update company_payment_notes for their business" ON public.company_payment_notes
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can view company_payment_notes for their business" ON public.company_payment_notes
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can delete return note orders" ON public.company_return_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can insert return note orders" ON public.company_return_note_orders
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can update return note orders" ON public.company_return_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can view return note orders" ON public.company_return_note_orders
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Authenticated users can manage company return notes" ON public.company_return_notes
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.company_zones
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can manage courier delivery notes" ON public.courier_delivery_notes
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.courier_fees
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can manage courier parcels" ON public.courier_parcels
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can manage courier return notes" ON public.courier_return_notes
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.courier_zones
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete expense_types" ON public.expense_types
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert expense_types" ON public.expense_types
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update expense_types" ON public.expense_types
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can view expense_types" ON public.expense_types
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete expenses" ON public.expenses
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert expenses" ON public.expenses
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update expenses" ON public.expenses
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can view expenses" ON public.expenses
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read master_cities" ON public.master_cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete seller_daily_earnings" ON public.old_seller_daily_earnings
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert seller_daily_earnings" ON public.old_seller_daily_earnings
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can select seller_daily_earnings" ON public.old_seller_daily_earnings
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update seller_daily_earnings" ON public.old_seller_daily_earnings
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to delete order_items" ON public.order_items
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to insert order_items" ON public.order_items
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to read order_items" ON public.order_items
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to update order_items" ON public.order_items
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to delete order_status_history" ON public.order_status_history
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to insert order_status_history" ON public.order_status_history
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to read order_status_history" ON public.order_status_history
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to update order_status_history" ON public.order_status_history
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read order_statuses" ON public.order_statuses
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to delete orders" ON public.orders
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to insert orders" ON public.orders
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to read orders" ON public.orders
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow authenticated users to update orders" ON public.orders
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read ozonexpress_cities" ON public.ozonexpress_cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read package_statuses" ON public.package_statuses
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Allow all for authenticated" ON public.plans
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Users can delete product_accessories" ON public.product_accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can insert product_accessories" ON public.product_accessories
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can update product_accessories" ON public.product_accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text))) WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Users can view product_accessories" ON public.product_accessories
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Authenticated users can delete products" ON public.products
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert products" ON public.products
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update products" ON public.products
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can view products" ON public.products
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read provider_cities" ON public.provider_cities
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.provider_webhooks
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users" ON public.providers
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete sales_channels" ON public.sales_channels
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert sales_channels" ON public.sales_channels
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update sales_channels" ON public.sales_channels
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can view sales_channels" ON public.sales_channels
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete seller_demands" ON public.seller_demands
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert seller_demands" ON public.seller_demands
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can select seller_demands" ON public.seller_demands
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update seller_demands" ON public.seller_demands
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete seller_payments" ON public.seller_payments
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert seller_payments" ON public.seller_payments
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can select seller_payments" ON public.seller_payments
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update seller_payments" ON public.seller_payments
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can delete seller_presences" ON public.seller_presences
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can insert seller_presences" ON public.seller_presences
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can select seller_presences" ON public.seller_presences
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated users can update seller_presences" ON public.seller_presences
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable delete access for authenticated users" ON public.transactions
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable insert access for authenticated users" ON public.transactions
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable read access for authenticated users" ON public.transactions
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable update access for authenticated users" ON public.transactions
  USING (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users on trns_payment" ON public.trns_payment
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Enable all for authenticated users on trns_purchase" ON public.trns_purchase
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Profiles are viewable by everyone" ON public.users
  USING ((((SELECT auth.uid()) IS NOT NULL) OR ((SELECT auth.role()) = 'anon'::text)));

ALTER POLICY "Enable all for authenticated users" ON public.webhook_logs
  USING (((SELECT auth.role()) = 'authenticated'::text)) WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

ALTER POLICY "Authenticated read zones" ON public.zones
  USING (((SELECT auth.role()) = 'authenticated'::text));
