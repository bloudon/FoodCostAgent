import { useQuery } from "@tanstack/react-query";
import type { Company, User } from "@shared/schema";

export function useCompany() {
  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  const selectedCompanyId = currentUser?.role === "global_admin" 
    ? localStorage.getItem("selectedCompanyId")
    : currentUser?.companyId;
  
  const { data: company, isLoading } = useQuery<Company>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}`] : [],
    enabled: !!selectedCompanyId,
  });

  return { company, isLoading, selectedCompanyId };
}
