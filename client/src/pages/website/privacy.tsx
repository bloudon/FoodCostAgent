import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

export default function PrivacyPolicy() {
  const { lang } = useLanguage();

  return (
    <MarketingLayout>
      <MarketingHead
        title="Privacy Policy — FnB Cost Pro"
        description="How FnB Cost Pro collects, uses, and protects your data."
        lang={lang}
      />

      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
            Privacy Policy
          </h1>
          <p className="text-gray-400 text-sm">Last updated: July 2025</p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 prose prose-gray max-w-none">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Information We Collect</h2>
          <p className="text-gray-600 mb-6">
            We collect information you provide directly — such as your name, email address, company name,
            and payment details when you create an account or subscribe. We also collect operational data
            you enter into the platform (inventory counts, recipes, purchase orders, waste logs, and similar
            records) in order to deliver the service.
          </p>
          <p className="text-gray-600 mb-6">
            We automatically collect certain usage data including IP address, browser type, pages visited,
            and timestamps when you access the platform. This data is used to maintain security, diagnose
            issues, and improve the service.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">2. How We Use Your Information</h2>
          <p className="text-gray-600 mb-4">We use collected information to:</p>
          <ul className="list-disc pl-6 text-gray-600 mb-6 space-y-2">
            <li>Provide, operate, and maintain the FnB Cost Pro platform</li>
            <li>Process payments and manage your subscription</li>
            <li>Send transactional emails (receipts, password resets, account notices)</li>
            <li>Respond to support requests and inquiries</li>
            <li>Monitor platform health, diagnose errors, and improve performance</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p className="text-gray-600 mb-6">
            We do not sell your personal information or your operational data to third parties.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">3. Data Sharing</h2>
          <p className="text-gray-600 mb-6">
            We share data only with service providers necessary to operate the platform — including our
            cloud database provider, payment processor (Stripe), and transactional email service. Each
            provider is bound by a data processing agreement and may not use your data for their own
            purposes.
          </p>
          <p className="text-gray-600 mb-6">
            We may disclose information if required by law, court order, or to protect the rights and
            safety of FnB Cost Pro, our users, or the public.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">4. Data Retention</h2>
          <p className="text-gray-600 mb-6">
            We retain your account and operational data for as long as your account is active. If you
            close your account, we will delete or anonymize your data within 90 days, except where
            retention is required by law.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">5. Security</h2>
          <p className="text-gray-600 mb-6">
            We use industry-standard measures including encrypted connections (TLS), hashed passwords,
            and strict access controls to protect your data. No method of transmission over the internet
            is completely secure; we cannot guarantee absolute security, but we take reasonable precautions
            to protect your information.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">6. Your Rights</h2>
          <p className="text-gray-600 mb-4">
            Depending on your jurisdiction, you may have the right to access, correct, or delete your
            personal data, or to object to or restrict certain processing. To exercise these rights,
            contact us at the address below.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">7. Cookies</h2>
          <p className="text-gray-600 mb-6">
            We use session cookies to keep you logged in and functional cookies to remember your
            preferences. We do not use third-party advertising cookies.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">8. Changes to This Policy</h2>
          <p className="text-gray-600 mb-6">
            We may update this policy from time to time. We will notify you of material changes by
            email or by posting a notice in the platform. Continued use of the service after changes
            are posted constitutes acceptance of the revised policy.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">9. Contact</h2>
          <p className="text-gray-600 mb-6">
            Questions about this policy? Contact us at{" "}
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
