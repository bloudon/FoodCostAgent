import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

export default function TermsOfService() {
  const { lang } = useLanguage();

  return (
    <MarketingLayout>
      <MarketingHead
        title="Terms of Service — FnB Cost Pro"
        description="The terms governing your use of FnB Cost Pro."
        lang={lang}
      />

      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
            Terms of Service
          </h1>
          <p className="text-gray-400 text-sm">Last updated: July 2025</p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
          <p className="text-gray-600 mb-6">
            By accessing or using FnB Cost Pro ("the Service"), you agree to be bound by these Terms of
            Service. If you do not agree, do not use the Service. These terms apply to all users,
            including administrators, managers, and staff members who access the platform under a
            company account.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">2. The Service</h2>
          <p className="text-gray-600 mb-6">
            FnB Cost Pro provides cloud-based food and beverage cost management software including
            inventory tracking, recipe costing, purchase order management, waste logging, theoretical
            food cost analysis, and related tools. The Service is provided on a subscription basis.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">3. Accounts and Access</h2>
          <p className="text-gray-600 mb-6">
            You are responsible for maintaining the confidentiality of your login credentials and for
            all activity under your account. You must notify us immediately of any unauthorized use.
            Accounts may not be shared or transferred without prior written consent.
          </p>
          <p className="text-gray-600 mb-6">
            You must be at least 18 years old and authorized to enter into binding agreements on behalf
            of your organization to create an account.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">4. Subscriptions and Payment</h2>
          <p className="text-gray-600 mb-6">
            Subscriptions are billed in advance on a monthly or annual basis. All fees are
            non-refundable except where required by law. We reserve the right to change pricing with
            30 days' notice. Continued use after a price change constitutes acceptance of the new
            pricing. Late or failed payments may result in suspension of access.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">5. Your Data</h2>
          <p className="text-gray-600 mb-6">
            You retain ownership of all data you enter into the Service. By using the Service, you
            grant FnB Cost Pro a limited license to store, process, and display your data solely for
            the purpose of providing the Service to you. We do not sell your data.
          </p>
          <p className="text-gray-600 mb-6">
            You are responsible for the accuracy and legality of the data you input. You represent that
            you have the rights necessary to upload and use any content you provide.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">6. Acceptable Use</h2>
          <p className="text-gray-600 mb-4">You agree not to:</p>
          <ul className="list-disc pl-6 text-gray-600 mb-6 space-y-2">
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure</li>
            <li>Interfere with or disrupt the Service or its servers</li>
            <li>Reverse engineer, decompile, or otherwise attempt to extract source code</li>
            <li>Use the Service to transmit spam, malware, or other harmful content</li>
            <li>Resell or sublicense access to the Service without written permission</li>
          </ul>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">7. Intellectual Property</h2>
          <p className="text-gray-600 mb-6">
            The Service, including all software, design, trademarks, and content created by FnB Cost Pro,
            is owned by FnB Cost Pro and protected by applicable intellectual property laws. These terms
            do not grant you any ownership rights in the Service.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">8. Disclaimers</h2>
          <p className="text-gray-600 mb-6">
            The Service is provided "as is" and "as available" without warranties of any kind, express
            or implied. We do not warrant that the Service will be uninterrupted, error-free, or that
            any specific results will be achieved through use of the Service. Cost and margin
            calculations are estimates based on data you provide; you are responsible for verifying
            accuracy before making business decisions.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">9. Limitation of Liability</h2>
          <p className="text-gray-600 mb-6">
            To the maximum extent permitted by law, FnB Cost Pro shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, including lost profits or data,
            arising out of or related to your use of the Service. Our total liability for any claim
            shall not exceed the amount you paid for the Service in the 12 months preceding the claim.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">10. Termination</h2>
          <p className="text-gray-600 mb-6">
            You may cancel your subscription at any time from your account settings. We may suspend or
            terminate your account if you violate these terms, with or without notice. Upon termination,
            your right to use the Service ceases immediately.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">11. Changes to Terms</h2>
          <p className="text-gray-600 mb-6">
            We may update these terms at any time. We will provide notice of material changes via email
            or in-platform notice. Continued use of the Service after changes take effect constitutes
            acceptance of the revised terms.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">12. Governing Law</h2>
          <p className="text-gray-600 mb-6">
            These terms are governed by the laws of the jurisdiction in which FnB Cost Pro operates,
            without regard to conflict of law principles.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">13. Contact</h2>
          <p className="text-gray-600 mb-6">
            Questions about these terms? Contact us at{" "}
            <a href="/contact" className="text-orange-500 hover:underline">
              fnbcostpro.com/contact
            </a>
            .
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
