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
import DeliveryNote from "./pages/DeliveryNote";
import ReturnNote from "./pages/ReturnNote";
import DeliveryServices from "./pages/DeliveryServices";
import Payments from "./pages/Payments";
import Transactions from "./pages/Transactions";
import Products from "./pages/Products";
import Status from "./pages/Status";
import Analytics from "./pages/Analytics";
import SalesChannels from "./pages/SalesChannels";
import Customers from "./pages/Customers";
import Users from "./pages/Users";
import AdsHistory from "./pages/AdsHistory";
import ExpensesDetails from "./pages/ExpensesDetails";
import ExpensesTypes from "./pages/ExpensesTypes";
import Cities from "./pages/Cities";
import Zones from "./pages/Zones";
import Profile from "./pages/Profile";
import Webhooks from "./pages/Webhooks";
import Businesses from "./pages/Businesses";
import SelectBusiness from "./pages/SelectBusiness";
import Calculator from "./pages/Calculator";
import AppLayout from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { Navigate, useLocation } from "react-router-dom";

// A small guard to ensure business is selected
const BusinessGuard = ({ children }: { children: React.ReactNode }) => {
  const activeBusinessId = localStorage.getItem('activeBusinessId');
  const location = useLocation();

  if (!activeBusinessId && location.pathname !== '/select-business') {
    return <Navigate to="/select-business" replace />;
  }

  return <>{children}</>;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/select-business" element={
            <ProtectedRoute>
              <SelectBusiness />
            </ProtectedRoute>
          } />
          <Route path="*" element={
            <ProtectedRoute>
              <BusinessGuard>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* ... other routes ... */}
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/import-orders" element={<ImportOrders />} />
                    <Route path="/delivery-note" element={<DeliveryNote />} />
                    <Route path="/return-note" element={<ReturnNote />} />
                    <Route path="/delivery-services" element={<DeliveryServices />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/webhooks" element={<Webhooks />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/status" element={<Status />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/sales-channels" element={<SalesChannels />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/ads-history" element={<AdsHistory />} />
                    <Route path="/expenses-details" element={<ExpensesDetails />} />
                    <Route path="/expenses-types" element={<ExpensesTypes />} />
                    <Route path="/businesses" element={<Businesses />} />
                    <Route path="/cities" element={<Cities />} />
                    <Route path="/zones" element={<Zones />} />
                    <Route path="/calculator" element={<Calculator />} />
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
