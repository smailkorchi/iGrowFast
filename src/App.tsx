import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Register from "./pages/Register";
import ChangeCredentials from "./pages/ChangeCredentials";
import Dashboard from "./pages/admin/Dashboard";
import Orders from "./pages/admin/Orders";
import ImportOrders from "./pages/admin/ImportOrders";
import ImportProducts from "./pages/admin/ImportProducts";
import ImportAccessories from "./pages/admin/ImportAccessories";
import ImportCustomers from "./pages/admin/ImportCustomers";
import DeliveryNote from "./pages/admin/DeliveryNote";
import ReturnNote from "./pages/admin/ReturnNote";
import DeliveryServices from "./pages/admin/DeliveryServices";
import Payments from "./pages/admin/Payments";
import Transactions from "./pages/admin/Transactions";
import Products from "./pages/admin/Products";
import Accessories from "./pages/admin/Accessories";
import Analytics from "./pages/admin/Analytics";
import SalesChannels from "./pages/admin/SalesChannels";
import SheetReview from "./pages/admin/SheetReview";
import Customers from "./pages/admin/Customers";
import Users from "./pages/admin/Users";
import AdsHistory from "./pages/AdsHistory";
import ExpensesDetails from "./pages/admin/ExpensesDetails";
import ExpensesTypes from "./pages/admin/ExpensesTypes";
import RecurringCharges from "./pages/admin/RecurringCharges";
import Profile from "./pages/admin/Profile";
import Webhooks from "./pages/admin/Webhooks";
import Trash from "./pages/admin/Trash";
import OwnerBusinesses from "./pages/owner/Businesses";
import OwnerUsers from "./pages/owner/Users";
import OwnerPlans from "./pages/owner/Plans";
import OwnerPayments from "./pages/owner/Payments";
import OwnerDashboard from "./pages/owner/OwnerDashboard";
import OwnerStatus from "./pages/owner/Status";
import OwnerCities from "./pages/owner/Cities";
import OwnerZones from "./pages/owner/Zones";
import GoogleAnalyticsPage from "./pages/analytics/GoogleAnalytics";
import MetaAdsPage from "./pages/analytics/MetaAds";
import OwnerLayout from "./components/layout/OwnerLayout";
import CourierLayout from "./components/layout/CourierLayout";
import CourierDashboard from "./pages/courier/Dashboard";
import CourierOrders from "./pages/courier/Orders";
import CourierPayments from "./pages/courier/Payments";
import CourierProfile from "./pages/courier/Profile";
import MediaBuyerLayout from "./components/layout/MediaBuyerLayout";
import MediaBuyerDashboard from "./pages/mediabuyer/Dashboard";
import MediaBuyerStatistics from "./pages/mediabuyer/Statistics";
import MediaBuyerCampaigns from "./pages/mediabuyer/Campaigns";
import MediaBuyerCampaignForm from "./pages/mediabuyer/CampaignForm";
import MediaBuyerCampaignPreview from "./pages/mediabuyer/CampaignPreview";
import MediaBuyerCampaignManage from "./pages/mediabuyer/CampaignManage";
import MediaBuyerPayments from "./pages/mediabuyer/Payments";
import MediaBuyerDemands from "./pages/mediabuyer/Demands";
import MediaBuyerOrders from "./pages/mediabuyer/Orders";
import Calculator from "./pages/admin/Calculator";
import Devis from "./pages/admin/tools/Devis";
import Facture from "./pages/admin/tools/Facture";
import BonDeCommande from "./pages/admin/tools/BonDeCommande";
import BonDeLivraison from "./pages/admin/tools/BonDeLivraison";
import AdminDemands from "./pages/admin/Demands";
import AdminSalaries from "./pages/admin/Salaries";
import AdminSellers from "./pages/admin/collaborators/Sellers";
import AdminCouriers from "./pages/admin/collaborators/Couriers";
import AdminMediaBuyers from "./pages/admin/collaborators/MediaBuyers";
import AdminBusinessOverview from "./pages/admin/business/Overview";
import AdminBusinessPayments from "./pages/admin/business/Payments";
import SellerDashboard from "./pages/seller/Dashboard";
import SellerOrders from "./pages/seller/Orders";
import SellerPayments from "./pages/seller/Payments";
import SellerProfile from "./pages/seller/Profile";
import SellerStatistics from "./pages/seller/Statistics";
import SellerWallet from "./pages/seller/Wallet";
import SellerDemands from "./pages/seller/Demands";
import SellerDeliveryNote from "./pages/seller/DeliveryNote";
import SellerReturnNote from "./pages/seller/ReturnNote";
import SellerProducts from "./pages/seller/Products";
import SellerAccessories from "./pages/seller/Accessories";
import SellerWhatsAppInbox from "./pages/seller/WhatsAppInbox";
import SellerHelp from "./pages/seller/Help";
import { WhatsAppNotificationsProvider } from "./components/notifications/WhatsAppNotificationsProvider";
import AppLayout from "./components/layout/AppLayout";
import SellerLayout from "./components/layout/SellerLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { MediaBuyerIntegrationGuard } from "./components/auth/MediaBuyerIntegrationGuard";
import { Navigate } from "react-router-dom";

// WhatsApp Imports
import WhatsAppManager from "./pages/admin/business/WhatsAppManager";
import WhatsAppInbox from "./pages/admin/business/WhatsAppInbox";
import AIBrainConsole from "./pages/admin/business/AIBrainConsole";
import OwnerAIConsole from "./pages/owner/OwnerAIConsole";
import OwnerConfig from "./pages/owner/Config";
import OwnerEmailTemplates from "./pages/owner/EmailTemplates";
import OwnerProfile from "./pages/owner/Profile";
import MediaBuyerProfile from "./pages/mediabuyer/Profile";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { FullscreenLoader } from "@/components/ui/fullscreen-loader";
import SuspensionOverlay from "./components/layout/SuspensionOverlay";

const BusinessGuard = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const qsId = params.get('businessId');
    if (qsId) {
      localStorage.setItem('activeBusinessId', qsId);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return !!localStorage.getItem('activeBusinessId');
  });
  const [businessStatus, setBusinessStatus] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('users')
        .select('"DigiCom Business", role')
        .eq('id', user.id)
        .single();

      if (profile?.role) setUserRole(profile.role);

      if (!ready && profile?.['DigiCom Business']) {
        localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
      }

      const bid = localStorage.getItem('activeBusinessId');
      if (bid) {
        setBusinessId(bid);
        const { data: business } = await supabase
          .from('businesses')
          .select('status')
          .eq('id', bid)
          .single();

        setBusinessStatus(business?.status || 'active');
      }

      setReady(true);
    };

    resolve();
  }, [ready]);

  if (!ready) {
    return <FullscreenLoader sublabel="Nous vérifions votre session et chargeons votre espace." />;
  }

  const isSuspended = businessStatus && businessStatus !== 'active' && userRole !== 'owner';

  return (
    <>
      {children}
      {isSuspended && businessId && (
        <SuspensionOverlay role="admin" businessId={businessId} />
      )}
    </>
  );
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150} skipDelayDuration={150}>
      <Toaster />
      <Sonner duration={500} />
      <BrowserRouter>
        <WhatsAppNotificationsProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          {/* Public self-registration via a single-use admin invite link */}
          <Route path="/register/:token" element={<Register />} />
          {/* Public credential change (email/password) via a single-use admin-sent link */}
          <Route path="/account/change/:token" element={<ChangeCredentials />} />
          {/* Owner Routes */}
          <Route path="/owner/*" element={
            <ProtectedRoute allowedRoles={['owner']}>
              <OwnerLayout>
                <Routes>
                  <Route path="dashboard" element={<OwnerDashboard />} />
                  <Route path="businesses" element={<OwnerBusinesses />} />
                  <Route path="plans" element={<OwnerPlans />} />
                  <Route path="payments" element={<OwnerPayments />} />
                  <Route path="users" element={<OwnerUsers />} />
                  <Route path="status" element={<OwnerStatus />} />
                  <Route path="cities" element={<OwnerCities />} />
                  <Route path="zones" element={<OwnerZones />} />
                  <Route path="ai" element={<OwnerAIConsole />} />
                  <Route path="email-templates" element={<OwnerEmailTemplates />} />
                  <Route path="config" element={<OwnerConfig />} />
                  <Route path="profile" element={<OwnerProfile />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </OwnerLayout>
            </ProtectedRoute>
          } />

          {/* Media Buyer Routes */}
          <Route path="/mediabuyer/*" element={
            <ProtectedRoute allowedRoles={['mediabuyer']}>
              <MediaBuyerLayout>
                <Routes>
                  <Route path="dashboard" element={<MediaBuyerDashboard />} />
                  <Route path="statistics" element={<MediaBuyerStatistics />} />
                  <Route path="campaigns" element={<MediaBuyerCampaigns />} />
                  <Route path="campaigns/new" element={<MediaBuyerCampaignForm />} />
                  <Route path="campaigns/:id" element={<MediaBuyerCampaignPreview />} />
                  <Route path="campaigns/:id/edit" element={<MediaBuyerCampaignForm />} />
                  <Route path="campaigns/:id/manage" element={<MediaBuyerCampaignManage />} />
                  <Route path="product-ads" element={<AdsHistory />} />
                  <Route path="orders" element={<MediaBuyerOrders />} />
                  <Route path="payments" element={<MediaBuyerPayments />} />
                  <Route path="demands" element={<MediaBuyerDemands />} />
                  <Route path="google-analytics" element={<MediaBuyerIntegrationGuard integration="ga"><GoogleAnalyticsPage /></MediaBuyerIntegrationGuard>} />
                  <Route path="meta-ads" element={<MediaBuyerIntegrationGuard integration="meta"><MetaAdsPage /></MediaBuyerIntegrationGuard>} />
                  <Route path="profile" element={<MediaBuyerProfile />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </MediaBuyerLayout>
            </ProtectedRoute>
          } />

          {/* Courier Routes */}
          <Route path="/courier/*" element={
            <ProtectedRoute allowedRoles={['courier']}>
              <CourierLayout>
                <Routes>
                  <Route path="dashboard" element={<CourierDashboard />} />
                  <Route path="orders" element={<CourierOrders />} />
                  <Route path="payments" element={<CourierPayments />} />
                  <Route path="profile" element={<CourierProfile />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </CourierLayout>
            </ProtectedRoute>
          } />

          {/* Seller Routes */}
          <Route path="/seller/*" element={
            <ProtectedRoute allowedRoles={['commercial']}>
              <SellerLayout>
                <Routes>
                  <Route path="dashboard" element={<SellerDashboard />} />
                  <Route path="orders" element={<SellerOrders />} />
                  <Route path="products" element={<SellerProducts />} />
                  <Route path="accessories" element={<SellerAccessories />} />
                  <Route path="payments" element={<SellerPayments />} />
                  <Route path="profile" element={<SellerProfile />} />
                  <Route path="statistics" element={<SellerStatistics />} />
                  <Route path="wallet" element={<SellerWallet />} />
                  <Route path="demands" element={<SellerDemands />} />
                  <Route path="delivery-note" element={<SellerDeliveryNote />} />
                  <Route path="return-note" element={<SellerReturnNote />} />
                  <Route path="whatsapp/inbox" element={<SellerWhatsAppInbox />} />
                  <Route path="help" element={<SellerHelp />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </SellerLayout>
            </ProtectedRoute>
          } />

          {/* Admin Routes — per-business; owners are confined to /owner/* and cannot enter here */}
          <Route path="*" element={
            <ProtectedRoute allowedRoles={['super admin', 'admin']}>
              <BusinessGuard>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* ... other routes ... */}
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/import-orders" element={<ImportOrders />} />
                    <Route path="/import-products" element={<ImportProducts />} />
                    <Route path="/import-accessories" element={<ImportAccessories />} />
                    <Route path="/import-customers" element={<ImportCustomers />} />
                    <Route path="/delivery-note" element={<DeliveryNote />} />
                    <Route path="/return-note" element={<ReturnNote />} />
                    <Route path="/delivery-services" element={<DeliveryServices />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/webhooks" element={<Webhooks />} />
                    <Route path="/trash" element={<Trash />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/accessories" element={<Accessories />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/google-analytics" element={<GoogleAnalyticsPage />} />
                    <Route path="/meta-ads" element={<MetaAdsPage />} />
                    <Route path="/sales-channels" element={<SalesChannels />} />
                    <Route path="/sheet-review" element={<SheetReview />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/ads-history" element={<AdsHistory />} />
                    <Route path="/campaigns" element={<MediaBuyerCampaigns />} />
                    <Route path="/campaigns/new" element={<MediaBuyerCampaignForm />} />
                    <Route path="/campaigns/:id" element={<MediaBuyerCampaignPreview />} />
                    <Route path="/campaigns/:id/edit" element={<MediaBuyerCampaignForm />} />
                    <Route path="/campaigns/:id/manage" element={<MediaBuyerCampaignManage />} />
                    <Route path="/expenses-details" element={<ExpensesDetails />} />
                    <Route path="/expenses-types" element={<ExpensesTypes />} />
                    <Route path="/recurring-charges" element={<RecurringCharges />} />
                    <Route path="/calculator" element={<Calculator />} />
                    <Route path="/devis" element={<Devis />} />
                    <Route path="/facture" element={<Facture />} />
                    <Route path="/bon-de-commande" element={<BonDeCommande />} />
                    <Route path="/bon-de-livraison" element={<BonDeLivraison />} />
                    <Route path="/demands" element={<AdminDemands />} />
                    <Route path="/salaries" element={<AdminSalaries />} />
                    <Route path="/collaborators/sellers" element={<AdminSellers />} />
                    <Route path="/collaborators/couriers" element={<AdminCouriers />} />
                    <Route path="/collaborators/mediabuyers" element={<AdminMediaBuyers />} />
                    {/* Back-compat: old /sellers route still resolves to the new location. */}
                    <Route path="/sellers" element={<AdminSellers />} />
                    <Route path="/business" element={<AdminBusinessOverview />} />
                    <Route path="/business/payments" element={<AdminBusinessPayments />} />
                    <Route path="/business/whatsapp/manager" element={<WhatsAppManager />} />
                    <Route path="/business/whatsapp/inbox" element={<WhatsAppInbox />} />
                    <Route path="/business/ai-brain" element={<AIBrainConsole />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppLayout>
              </BusinessGuard>
            </ProtectedRoute>
          } />
        </Routes>
        </WhatsAppNotificationsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
