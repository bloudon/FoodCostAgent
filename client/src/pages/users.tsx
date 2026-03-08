import { UsersManagement } from "@/components/UsersManagement";
import { SetupProgressBanner } from "@/components/setup-progress-banner";
import { useAuth } from "@/lib/auth-context";

export default function Users() {
  const { getEffectiveCompanyId } = useAuth();
  const companyId = getEffectiveCompanyId();
  
  if (!companyId) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center text-muted-foreground">
          No company selected
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 pb-16">
      <UsersManagement companyId={companyId} />
      <SetupProgressBanner currentMilestoneId="team" hasEntries={true} />
    </div>
  );
}
