import { useState } from "react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useCustomer, type Customer } from "@/customer/CustomerProvider";

// Saving a phone number goes through an edge function rather than a table write
// for the same reason everything else here does: a LINE customer has no Supabase
// JWT, so the signed loyalty token is the only identity we can check.
export function usePhone(qrToken: string | null) {
  const { applyCustomer } = useCustomer();
  const [saving, setSaving] = useState(false);

  async function savePhone(phone: string): Promise<void> {
    if (!qrToken) throw new Error("No card token");
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ customer: Customer }>("update-customer-phone", {
        body: { qr_token: qrToken, phone },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      if (data?.customer) applyCustomer(data.customer);
    } finally {
      setSaving(false);
    }
  }

  return { savePhone, saving };
}
