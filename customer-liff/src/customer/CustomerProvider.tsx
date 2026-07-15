import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { resolveLineIdentity } from "@/lib/liffIdentity";

export type Customer = {
  id: string;
  shop_id: string;
  display_name: string | null;
  picture_url: string | null;
  phone: string | null;
  points_balance: number;
};

type Shop = { id: string; name: string };

type CustomerState = {
  customer: Customer | null;
  qrToken: string | null;
  shop: Shop | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Lets a mutation that already returns the fresh customer (e.g. saving a phone
  // number, claiming a points QR) push it into context, instead of re-running the
  // whole registration. Takes an updater too, so a caller holding only a new
  // balance can patch the current customer without a stale copy of it.
  applyCustomer: Dispatch<SetStateAction<Customer | null>>;
};

const CustomerContext = createContext<CustomerState | undefined>(undefined);

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setLoading(true);
    setError(null);
    try {
      const identity = await resolveLineIdentity();
      const { data, error: fnError } = await supabase.functions.invoke<{
        customer: Customer;
        qr_token: string;
        shop: Shop;
      }>("register-customer", {
        body: {
          shop_id: identity.shopId,
          id_token: identity.idToken,
          dev_line_user_id: identity.devLineUserId,
          dev_display_name: identity.devDisplayName,
        },
      });
      if (fnError) throw fnError;
      if (!data) throw new Error("No response from register-customer");
      setCustomer(data.customer);
      setQrToken(data.qr_token);
      setShop(data.shop);
    } catch (err) {
      setError(await getFunctionErrorMessage(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    register();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CustomerContext.Provider
      value={{ customer, qrToken, shop, loading, error, refresh: register, applyCustomer: setCustomer }}
    >
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error("useCustomer must be used within CustomerProvider");
  return ctx;
}
