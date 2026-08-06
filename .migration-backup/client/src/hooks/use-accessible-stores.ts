import { useQuery } from "@tanstack/react-query";

type CompanyStore = {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  tccLocationId: string | null;
  status: string;
};

export function useAccessibleStores() {
  return useQuery<CompanyStore[]>({
    queryKey: ["/api/stores/accessible"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
