import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

export default function PrivacyPolicy() {
  const { lang } = useLanguage();
  const isEs = lang === "es";

  return (
    <MarketingLayout>
      <MarketingHead
        title={isEs ? "Política de privacidad — FnB Cost Pro" : "Privacy Policy — FnB Cost Pro"}
        description={isEs ? "Cómo FnB Cost Pro recopila, usa y protege tus datos." : "How FnB Cost Pro collects, uses, and protects your data."}
        lang={lang}
      />

      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
            {isEs ? "Política de privacidad" : "Privacy Policy"}
          </h1>
          <p className="text-gray-400 text-sm">{isEs ? "Última actualización: julio 2025" : "Last updated: July 2025"}</p>
        </div>
      </section>

      {isEs ? (
        <section className="py-16 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 prose prose-gray max-w-none">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Información que recopilamos</h2>
            <p className="text-gray-600 mb-6">
              Recopilamos la información que proporcionas directamente, como tu nombre, correo electrónico,
              nombre de empresa y datos de pago cuando creas una cuenta o te suscribes. También recopilamos
              los datos operativos que introduces en la plataforma (conteos de inventario, recetas, órdenes
              de compra, registros de desperdicio y registros similares) para prestar el servicio.
            </p>
            <p className="text-gray-600 mb-6">
              Recopilamos automáticamente ciertos datos de uso, como dirección IP, tipo de navegador,
              páginas visitadas y marcas de tiempo cuando accedes a la plataforma. Estos datos se utilizan
              para mantener la seguridad, diagnosticar problemas y mejorar el servicio.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">2. Cómo usamos tu información</h2>
            <p className="text-gray-600 mb-4">Usamos la información recopilada para:</p>
            <ul className="list-disc pl-6 text-gray-600 mb-6 space-y-2">
              <li>Proporcionar, operar y mantener la plataforma FnB Cost Pro</li>
              <li>Procesar pagos y gestionar tu suscripción</li>
              <li>Enviar correos transaccionales (recibos, restablecimiento de contraseña, avisos de cuenta)</li>
              <li>Responder solicitudes de soporte e inquietudes</li>
              <li>Monitorear el estado de la plataforma, diagnosticar errores y mejorar el rendimiento</li>
              <li>Cumplir con las obligaciones legales</li>
            </ul>
            <p className="text-gray-600 mb-6">
              No vendemos tu información personal ni tus datos operativos a terceros.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">3. Compartición de datos</h2>
            <p className="text-gray-600 mb-6">
              Compartimos datos solo con los proveedores de servicios necesarios para operar la
              plataforma, incluidos nuestro proveedor de base de datos en la nube, el procesador de pagos
              (Stripe) y el servicio de correo transaccional. Cada proveedor está sujeto a un acuerdo de
              procesamiento de datos y no puede usar tus datos para sus propios fines.
            </p>
            <p className="text-gray-600 mb-6">
              Podemos divulgar información si así lo exige la ley, una orden judicial, o para proteger
              los derechos y la seguridad de FnB Cost Pro, nuestros usuarios o el público.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">4. Retención de datos</h2>
            <p className="text-gray-600 mb-6">
              Conservamos tu cuenta y tus datos operativos mientras tu cuenta esté activa. Si cierras
              tu cuenta, eliminaremos o anonimizaremos tus datos en un plazo de 90 días, salvo que la
              retención sea requerida por ley.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">5. Seguridad</h2>
            <p className="text-gray-600 mb-6">
              Utilizamos medidas estándar de la industria, incluidas conexiones cifradas (TLS), contraseñas
              con hash y controles de acceso estrictos para proteger tus datos. Ningún método de transmisión
              por internet es completamente seguro; no podemos garantizar una seguridad absoluta, pero
              tomamos precauciones razonables para proteger tu información.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">6. Tus derechos</h2>
            <p className="text-gray-600 mb-4">
              Dependiendo de tu jurisdicción, puedes tener derecho a acceder, corregir o eliminar tus
              datos personales, o a oponerte o restringir cierto procesamiento. Para ejercer estos
              derechos, contáctanos en la dirección indicada a continuación.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">7. Cookies</h2>
            <p className="text-gray-600 mb-6">
              Usamos cookies de sesión para mantenerte conectado y cookies funcionales para recordar tus
              preferencias. No utilizamos cookies de publicidad de terceros.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">8. Cambios en esta política</h2>
            <p className="text-gray-600 mb-6">
              Podemos actualizar esta política periódicamente. Te notificaremos los cambios importantes
              por correo electrónico o mediante un aviso en la plataforma. El uso continuado del servicio
              después de publicar los cambios constituye la aceptación de la política revisada.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">9. Contacto</h2>
            <p className="text-gray-600 mb-6">
              ¿Tienes preguntas sobre esta política? Contáctanos en{" "}
              <a href="/es/contact" className="text-orange-500 hover:underline">
                fnbcostpro.com/es/contact
              </a>
              .
            </p>
          </div>
        </section>
      ) : (
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
      )}
    </MarketingLayout>
  );
}
