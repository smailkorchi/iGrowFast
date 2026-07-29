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
import SellerHelp from "./pages/seller/Help";
import AppLayout from "./components/layout/AppLayout";
import SellerLayout from "./components/layout/SellerLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { MediaBuyerIntegrationGuard } from "./components/auth/MediaBuyerIntegrationGuard";
import { Navigate } from "react-router-dom";

import OwnerConfig from "./pages/owner/Config";
import OwnerEmailTemplates from "./pages/owner/EmailTemplates";
import OwnerProfile from "./pages/owner/Profile";
import OwnerBackups from "./pages/owner/Backups";
import MediaBuyerProfile from "./pages/mediabuyer/Profile";
import { useEffect, useState, lazy, Suspense } from "react";

// WhatsApp inbox — isolated module, lazy-loaded (own CSS/bundle; not shipped to
// non-WhatsApp users). Page 1a: Numbers + pairing. Page 1b: Number detail.
const WhatsappNumbers = lazy(() => import("@/whatsapp/WhatsappNumbers"));
const WhatsappNumberDetail = lazy(() => import("@/whatsapp/WhatsappNumberDetail"));
// Page 2: the inbox — WA-verbatim tier (own scoped WA CSS under .wa-root).
const WhatsappConversations = lazy(() => import("@/whatsapp/WhatsappConversations"));
// Page 5: assignment routing console — management tier (donor light chrome).
const WhatsappAssignment = lazy(() => import("@/whatsapp/WhatsappAssignment"));
// Page 4: contacts directory — management tier (donor light chrome).
const WhatsappContacts = lazy(() => import("@/whatsapp/WhatsappContacts"));
// Page 3: seller (agent) inbox — WA-verbatim tier, assignment-scoped via RLS.
const WhatsappSellerInbox = lazy(() => import("@/whatsapp/WhatsappSellerInbox"));
// Lazy: heavy react-pdf (doc-gen tools) + xlsx (import wizards) — kept OFF the eager bundle.
const ImportOrders = lazy(() => import("./pages/admin/ImportOrders"));
const ImportProducts = lazy(() => import("./pages/admin/ImportProducts"));
const ImportAccessories = lazy(() => import("./pages/admin/ImportAccessories"));
const ImportCustomers = lazy(() => import("./pages/admin/ImportCustomers"));
const Devis = lazy(() => import("./pages/admin/tools/Devis"));
const Facture = lazy(() => import("./pages/admin/tools/Facture"));
const BonDeCommande = lazy(() => import("./pages/admin/tools/BonDeCommande"));
const BonDeLivraison = lazy(() => import("./pages/admin/tools/BonDeLivraison"));
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
      // getSession (local JWT) not getUser (network→GoTrue): ProtectedRoute already
      // validated the session upstream, and RLS enforces on the selects below.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
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

const queryClient = new QueryClient({
  defaultOptions: {
    // retry 3 (the library default) burns 4 round-trips + ~7s of exponential
    // backoff on every DETERMINISTIC failure — an RLS 42501 (the admin-gated
    // stats RPCs), a PostgREST 400, a raised RPC guard. None of those get
    // better by retrying. Matches waQueryClient's policy.
    // staleTime is deliberately left at the library default (0): the heavy
    // pages all set their own 60s inline, while the un-swept pages have no
    // realtime and rely on focus-refetch to stay correct (see docs/d7-recon).
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

// The SPA never unmounts on logout (sign-out is a client-side navigate, there
// is no reload anywhere) and this client is a module singleton — so without
// this, signing in as another user renders the PREVIOUS user's cached rows
// stale-while-revalidating, and any query key that does not carry the business
// id (profiles, 'plans', 'zones', 'master-cities', 'businesses', …) can keep
// serving them. Purge everything on sign-out. Mirrors waQueryClient.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") queryClient.clear();
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150} skipDelayDuration={150}>
      <Toaster />
      <Sonner duration={500} />
      <BrowserRouter>
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
                  <Route path="email-templates" element={<OwnerEmailTemplates />} />
                  <Route path="config" element={<OwnerConfig />} />
                  <Route path="backups" element={<OwnerBackups />} />
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
                  <Route path="whatsapp" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappSellerInbox /></Suspense>} />
                  <Route path="help" element={<SellerHelp />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </SellerLayout>
            </ProtectedRoute>
          } />

          {/* Admin Routes — per-business; owners are confined to /owner/* and cannot enter here */}
          <Route path="*" element={
            <ProtectedRoute allowedRoles={['super admin', 'business owner', 'admin']}>
              <BusinessGuard>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* ... other routes ... */}
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/import-orders" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><ImportOrders /></Suspense>} />
                    <Route path="/import-products" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><ImportProducts /></Suspense>} />
                    <Route path="/import-accessories" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><ImportAccessories /></Suspense>} />
                    <Route path="/import-customers" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><ImportCustomers /></Suspense>} />
                    <Route path="/delivery-note" element={<DeliveryNote />} />
                    <Route path="/return-note" element={<ReturnNote />} />
                    <Route path="/delivery-services" element={<DeliveryServices />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/webhooks" element={<Webhooks />} />
                    <Route path="/trash" element={<Trash />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/whatsapp/numbers" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappNumbers /></Suspense>} />
                    <Route path="/whatsapp/numbers/:id" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappNumberDetail /></Suspense>} />
                    <Route path="/whatsapp/conversations" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappConversations /></Suspense>} />
                    <Route path="/whatsapp/assignment" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappAssignment /></Suspense>} />
                    <Route path="/whatsapp/contacts" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><WhatsappContacts /></Suspense>} />
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
                    <Route path="/devis" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><Devis /></Suspense>} />
                    <Route path="/facture" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><Facture /></Suspense>} />
                    <Route path="/bon-de-commande" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><BonDeCommande /></Suspense>} />
                    <Route path="/bon-de-livraison" element={<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}><BonDeLivraison /></Suspense>} />
                    <Route path="/demands" element={<AdminDemands />} />
                    <Route path="/salaries" element={<AdminSalaries />} />
                    <Route path="/collaborators/sellers" element={<AdminSellers />} />
                    <Route path="/collaborators/couriers" element={<AdminCouriers />} />
                    <Route path="/collaborators/mediabuyers" element={<AdminMediaBuyers />} />
                    {/* Back-compat: old /sellers route still resolves to the new location. */}
                    <Route path="/sellers" element={<AdminSellers />} />
                    <Route path="/business" element={<AdminBusinessOverview />} />
                    <Route path="/business/payments" element={<AdminBusinessPayments />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppLayout>
              </BusinessGuard>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
