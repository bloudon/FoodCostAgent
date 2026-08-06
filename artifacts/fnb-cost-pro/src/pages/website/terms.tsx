import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

export default function TermsOfService() {
  const { lang } = useLanguage();
  const isEs = lang === "es";

  return (
    <MarketingLayout>
      <MarketingHead
        title={isEs ? "Términos de servicio — FnB Cost Pro" : "Terms of Service — FnB Cost Pro"}
        description={isEs ? "Los términos que rigen tu uso de FnB Cost Pro." : "The terms governing your use of FnB Cost Pro."}
        lang={lang}
      />

      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 leading-tight">
            {isEs ? "Términos de servicio" : "Terms of Service"}
          </h1>
          <p className="text-gray-400 text-sm">{isEs ? "Última actualización: julio 2025" : "Last updated: July 2025"}</p>
        </div>
      </section>

      {isEs ? (
        <section className="py-16 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Aceptación de los términos</h2>
            <p className="text-gray-600 mb-6">
              Al acceder o usar FnB Cost Pro ("el Servicio"), aceptas quedar vinculado por estos Términos de
              Servicio. Si no estás de acuerdo, no uses el Servicio. Estos términos se aplican a todos los
              usuarios, incluidos administradores, gerentes y miembros del personal que acceden a la
              plataforma bajo una cuenta de empresa.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">2. El Servicio</h2>
            <p className="text-gray-600 mb-6">
              FnB Cost Pro proporciona software de gestión de costos de alimentos y bebidas en la nube,
              que incluye seguimiento de inventario, costeo de recetas, gestión de órdenes de compra,
              registro de desperdicios, análisis de costo teórico de alimentos y herramientas relacionadas.
              El Servicio se presta en modalidad de suscripción.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">3. Cuentas y acceso</h2>
            <p className="text-gray-600 mb-6">
              Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de toda
              la actividad bajo tu cuenta. Debes notificarnos inmediatamente cualquier uso no autorizado.
              Las cuentas no pueden compartirse ni transferirse sin consentimiento previo por escrito.
            </p>
            <p className="text-gray-600 mb-6">
              Debes tener al menos 18 años y estar autorizado para celebrar acuerdos vinculantes en nombre
              de tu organización para crear una cuenta.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">4. Suscripciones y pago</h2>
            <p className="text-gray-600 mb-6">
              Las suscripciones se facturan por adelantado de forma mensual o anual. Todas las tarifas
              son no reembolsables, salvo que lo exija la ley. Nos reservamos el derecho de modificar los
              precios con 30 días de anticipación. El uso continuado tras un cambio de precio constituye
              la aceptación del nuevo precio. Los pagos tardíos o fallidos pueden resultar en la suspensión
              del acceso.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">5. Tus datos</h2>
            <p className="text-gray-600 mb-6">
              Conservas la propiedad de todos los datos que introduces en el Servicio. Al usar el Servicio,
              otorgas a FnB Cost Pro una licencia limitada para almacenar, procesar y mostrar tus datos
              únicamente con el fin de prestarte el Servicio. No vendemos tus datos.
            </p>
            <p className="text-gray-600 mb-6">
              Eres responsable de la exactitud y legalidad de los datos que ingresas. Declaras que tienes
              los derechos necesarios para cargar y usar cualquier contenido que proporciones.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">6. Uso aceptable</h2>
            <p className="text-gray-600 mb-4">Te comprometes a no:</p>
            <ul className="list-disc pl-6 text-gray-600 mb-6 space-y-2">
              <li>Usar el Servicio para cualquier fin ilegal</li>
              <li>Intentar obtener acceso no autorizado a ninguna parte del Servicio o su infraestructura</li>
              <li>Interferir o interrumpir el Servicio o sus servidores</li>
              <li>Realizar ingeniería inversa, descompilar o intentar extraer el código fuente</li>
              <li>Usar el Servicio para transmitir spam, malware u otro contenido dañino</li>
              <li>Revender o sublicenciar el acceso al Servicio sin permiso por escrito</li>
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">7. Propiedad intelectual</h2>
            <p className="text-gray-600 mb-6">
              El Servicio, incluido todo el software, diseño, marcas comerciales y contenido creado por
              FnB Cost Pro, es propiedad de FnB Cost Pro y está protegido por las leyes de propiedad
              intelectual aplicables. Estos términos no te otorgan ningún derecho de propiedad sobre el
              Servicio.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">8. Exenciones de responsabilidad</h2>
            <p className="text-gray-600 mb-6">
              El Servicio se proporciona "tal cual" y "según disponibilidad", sin garantías de ningún tipo,
              expresas o implícitas. No garantizamos que el Servicio sea ininterrumpido, libre de errores
              ni que a través de su uso se obtengan resultados específicos. Los cálculos de costos y
              márgenes son estimaciones basadas en los datos que proporcionas; eres responsable de
              verificar la exactitud antes de tomar decisiones comerciales.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">9. Limitación de responsabilidad</h2>
            <p className="text-gray-600 mb-6">
              En la máxima medida permitida por la ley, FnB Cost Pro no será responsable de ningún daño
              indirecto, incidental, especial, consecuente o punitivo, incluidas pérdidas de ganancias o
              datos, que surja de o esté relacionado con tu uso del Servicio. Nuestra responsabilidad
              total por cualquier reclamación no excederá el monto que pagaste por el Servicio en los
              12 meses anteriores a la reclamación.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">10. Terminación</h2>
            <p className="text-gray-600 mb-6">
              Puedes cancelar tu suscripción en cualquier momento desde la configuración de tu cuenta.
              Podemos suspender o cancelar tu cuenta si incumples estos términos, con o sin previo aviso.
              Tras la terminación, tu derecho a usar el Servicio cesa de inmediato.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">11. Cambios en los términos</h2>
            <p className="text-gray-600 mb-6">
              Podemos actualizar estos términos en cualquier momento. Notificaremos los cambios importantes
              por correo electrónico o mediante un aviso en la plataforma. El uso continuado del Servicio
              tras la entrada en vigor de los cambios constituye la aceptación de los términos revisados.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">12. Ley aplicable</h2>
            <p className="text-gray-600 mb-6">
              Estos términos se rigen por las leyes de la jurisdicción en la que opera FnB Cost Pro,
              sin tener en cuenta los principios de conflicto de leyes.
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 mt-10">13. Contacto</h2>
            <p className="text-gray-600 mb-6">
              ¿Tienes preguntas sobre estos términos? Contáctanos en{" "}
              <a href="/es/contact" className="text-orange-500 hover:underline">
                fnbcostpro.com/es/contact
              </a>
              .
            </p>
          </div>
        </section>
      ) : (
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
      )}
    </MarketingLayout>
  );
}
