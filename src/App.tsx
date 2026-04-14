import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import ImportOrders from "./pages/ImportOrders";
import ImportProducts from "./pages/ImportProducts";
import ImportAccessories from "./pages/ImportAccessories";
import DeliveryNote from "./pages/DeliveryNote";
import ReturnNote from "./pages/ReturnNote";
import DeliveryServices from "./pages/DeliveryServices";
import Payments from "./pages/Payments";
import Transactions from "./pages/Transactions";
import Products from "./pages/Products";
import Accessories from "./pages/Accessories";
import Analytics from "./pages/Analytics";
import SalesChannels from "./pages/SalesChannels";
import Customers from "./pages/Customers";
import Users from "./pages/Users";
import AdsHistory from "./pages/AdsHistory";
import ExpensesDetails from "./pages/ExpensesDetails";
import ExpensesTypes from "./pages/ExpensesTypes";
import Profile from "./pages/Profile";
import Webhooks from "./pages/Webhooks";
import AiKeys from "./pages/AiKeys";
import Trash from "./pages/Trash";
import OwnerBusinesses from "./pages/owner/Businesses";
import OwnerSelectBusiness from "./pages/owner/SelectBusiness";
import OwnerUsers from "./pages/owner/Users";
import OwnerPlans from "./pages/owner/Plans";
import OwnerPayments from "./pages/owner/Payments";
import OwnerDashboard from "./pages/owner/OwnerDashboard";
import OwnerStatus from "./pages/owner/Status";
import OwnerCities from "./pages/owner/Cities";
import OwnerZones from "./pages/owner/Zones";
import OwnerActivityLog from "./pages/owner/ActivityLog";
import ActivityLog from "./pages/ActivityLog";
import OwnerLayout from "./components/layout/OwnerLayout";
import CourierLayout from "./components/layout/CourierLayout";
import CourierDashboard from "./pages/courier/Dashboard";
import CourierOrders from "./pages/courier/Orders";
import CourierPayments from "./pages/courier/Payments";
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
import Calculator from "./pages/Calculator";
import Devis from "./pages/tools/Devis";
import Facture from "./pages/tools/Facture";
import BonDeCommande from "./pages/tools/BonDeCommande";
import BonDeLivraison from "./pages/tools/BonDeLivraison";
import AdminDemands from "./pages/Demands";
import AdminSalaries from "./pages/Salaries";
import AdminSellers from "./pages/collaborators/Sellers";
import AdminCouriers from "./pages/collaborators/Couriers";
import AdminMediaBuyers from "./pages/collaborators/MediaBuyers";
import AdminBusinessOverview from "./pages/business/Overview";
import AdminBusinessPayments from "./pages/business/Payments";
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
import { WhatsAppNotificationsProvider } from "./components/notifications/WhatsAppNotificationsProvider";
import AppLayout from "./components/layout/AppLayout";
import SellerLayout from "./components/layout/SellerLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { Navigate } from "react-router-dom";

// WhatsApp Imports
import WhatsAppManager from "./pages/business/WhatsAppManager";
import WhatsAppInbox from "./pages/business/WhatsAppInbox";
import WhatsAppAutomations from "./pages/business/WhatsAppAutomations";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { Loader2 } from "lucide-react";
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-navy" />
      </div>
    );
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
          {/* Owner Routes */}
          <Route path="/owner/select-business" element={
            <ProtectedRoute allowedRoles={['owner']}>
              <OwnerSelectBusiness />
            </ProtectedRoute>
          } />
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
                  <Route path="activity-log" element={<OwnerActivityLog />} />
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
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </SellerLayout>
            </ProtectedRoute>
          } />

          {/* Admin Routes (owner can access via new tab) */}
          <Route path="*" element={
            <ProtectedRoute allowedRoles={['super admin', 'admin', 'owner']}>
              <BusinessGuard>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* ... other routes ... */}
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/import-orders" element={<ImportOrders />} />
                    <Route path="/import-products" element={<ImportProducts />} />
                    <Route path="/import-accessories" element={<ImportAccessories />} />
                    <Route path="/delivery-note" element={<DeliveryNote />} />
                    <Route path="/return-note" element={<ReturnNote />} />
                    <Route path="/delivery-services" element={<DeliveryServices />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/webhooks" element={<Webhooks />} />
                    <Route path="/ai-keys" element={<AiKeys />} />
                    <Route path="/trash" element={<Trash />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/accessories" element={<Accessories />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/sales-channels" element={<SalesChannels />} />
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
                    <Route path="/calculator" element={<Calculator />} />
                    <Route path="/devis" element={<Devis />} />
                    <Route path="/facture" element={<Facture />} />
                    <Route path="/bon-de-commande" element={<BonDeCommande />} />
                    <Route path="/bon-de-livraison" element={<BonDeLivraison />} />
                    <Route path="/demands" element={<AdminDemands />} />
                    <Route path="/activity-log" element={<ActivityLog />} />
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
                    <Route path="/business/whatsapp/automations" element={<WhatsAppAutomations />} />
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
