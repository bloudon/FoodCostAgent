export type Language = "en" | "es";

export const translations = {
  en: {
    nav: {
      features: "Features",
      pricing: "Pricing",
      about: "About",
      contact: "Contact",
      login: "Log in",
      getStarted: "Get Started",
      myAccount: "My Account",
      goToDashboard: "Go to Dashboard",
      signOut: "Sign out",
      signingOut: "Signing out…",
    },
    footer: {
      tagline: "Photo-first inventory management and recipe costing for restaurants and Food & Beverage businesses.",
      product: "Product",
      getStarted: "Get Started",
      getStartedFree: "Get Started",
      login: "Log in",
      viewPricing: "View Pricing",
      company: "Company",
      about: "About",
      contact: "Contact",
      rights: "All rights reserved.",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
    },
    home: {
      meta: {
        title: "FnB Cost Pro — Culinary Operations Intelligence for Chef-Led Restaurants",
        description:
          "FnB Cost Pro brings inventory intelligence, live recipe costing, and vendor connectivity to chef-led restaurants and F&B operations. Built for the way professional kitchens work.",
      },
      badge: "Culinary Operations Intelligence",
      headline: "Built for the way chefs work.",
      subheadline:
        "Turn handwritten recipes, photos, invoices and existing files into accurate recipe costs, inventory intelligence and smarter purchasing — without burying your culinary team in data entry.",
      ctaPrimary: "Schedule a Culinary Review",
      ctaSecondary: "See How It Works",
      workflowLabel: "How it works",
      workflowItems: [
        { step: "Capture", phrase: "Photos, files and uploads — no re-keying required" },
        { step: "Cost", phrase: "Recipes priced from live vendor data, automatically" },
        { step: "Compare", phrase: "Theoretical vs. actual — see exactly where cost drifts" },
        { step: "Predict", phrase: "Order recommendations when you have the history to support them" },
      ],
      captureLabel: "What You Can Capture",
      captureTitle: "From a chef's photo to structured operational data.",
      captureCards: [
        {
          input: "Handwritten recipe",
          outputs: [
            "Structured ingredients and quantities",
            "Yield, portions and scaling",
            "Current recipe cost from live vendor pricing",
          ],
        },
        {
          input: "Invoice or order guide",
          outputs: [
            "Vendor items and pack sizes",
            "Delivered pricing per unit",
            "Price history and change tracking",
          ],
        },
        {
          input: "Inventory sheet",
          outputs: [
            "Inventory items and counts",
            "Storage location assignments",
            "Historical count and value data",
          ],
        },
        {
          input: "Product or case label",
          outputs: [
            "Product identity and description",
            "Units, pack geometry and catch weight",
            "Vendor-item matching and linking",
          ],
        },
      ],
      captureSummary:
        "Recipes, inventory, vendors, pricing and predicted purchasing remain connected throughout the operation.",
      purchasingLabel: "Purchasing Intelligence",
      purchasingTitle: "Current pricing. Valid comparisons. Smarter orders.",
      purchasingBody:
        "Capture account-specific vendor pricing from supported portals and existing files. Compare live prices across your distributor relationships and identify where an order guide has moved against your recipe costs.",
      purchasingBullets: [
        "Account-specific pricing from supported distributor portals",
        "Order guide imports from Sysco, GFS, US Foods and major distributors",
        "Invoice scan captures delivered prices for every line item",
        "Cross-vendor comparison when pricing is available from multiple order guides",
        "Recipe costs update automatically when vendor pricing changes",
        "Purchase order and receiving workflows connected to inventory",
      ],
      purchasingCta: "Schedule a Culinary Review",
      multiLabel: "Multi-Location",
      multiTitle: "Every kitchen, storeroom and outlet connected.",
      multiBody:
        "Model central storage, outlet inventory and shared item locations. Recipes and costs remain consistent across every operation — with per-location counts and variance reporting showing where each kitchen stands.",
      multiBullets: [
        "Central and outlet inventory modelled separately or together",
        "Shared item locations across storage areas and outlets",
        "Per-location counts and variance reports",
        "Consistent recipe costs across every operation",
        "Role-based access for admin, management and kitchen staff",
        "One account — every operation visible in one place",
      ],
      onboardingTitle: "Start with the operation you already have",
      onboardingItems: [
        "Bring your existing menus, recipe cards, invoices or order guides",
        "Capture them by photo, upload or file — no re-keying required",
        "Your team reviews and confirms every extracted item before it is saved",
        "Costs begin to connect as vendor data and recipe data align",
        "A Culinary Review session helps you read what the data is telling you",
      ],
      onboardingCta: "Schedule a Culinary Review",
      ctaBottomTitle: "Ready to see how it works in your kitchen?",
      ctaBottomBody:
        "Connect with our team. We'll review your current operation, answer your questions and confirm whether FnB Cost Pro is the right fit — before you commit to anything.",
      ctaBottomButton: "Schedule a Culinary Review",
    },
    features: {
      meta: {
        title: "Platform Features — FnB Cost Pro Culinary Operations Platform",
        description:
          "Explore FnB Cost Pro's culinary operations capabilities: menu scan, recipe costing, invoice capture, inventory counting, vendor connectivity, and cross-location management.",
      },
      badge: "Less Entry. More Intelligence.",
      headline: "From a chef's photo to structured operational data.",
      subheadline:
        "FnB Cost Pro turns your existing menus, recipe cards, vendor invoices and inventory materials into structured operational data — captured by photo or file, reviewed by your team before anything is saved.",
      badgesNote: "badges show which plan includes each feature",
      startFree: "Schedule a Culinary Review",
      heroSecondaryCtaLabel: "See How It Works",
      heroProofLine: "",
      upgradeTitle: "The platform fits the way your operation works",
      upgradeSubtitle: "Everything in one subscription. Scope expands as your operation grows.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Single Operation",
      upgradeStarterBody:
        "Photo-based setup, live recipe costing, vendor order guide imports, inventory counting workflows, Theoretical Food Cost variance reporting, and multi-seat team access. Everything you need to run a tight kitchen.",
      upgradeBasicTitle: "Single Operation",
      upgradeBasicBody:
        "Photo-based setup, live recipe costing, vendor order guide imports, inventory counting workflows, Theoretical Food Cost variance reporting, and multi-seat team access. Everything you need to run a tight kitchen.",
      upgradeProTitle: "Multi-Operation",
      upgradeProBody:
        "Everything in Single Operation plus shelf scanning by phone, cross-location variance reporting, cross-shop vendor pricing, transfer orders, and QuickBooks export. Built for operations running more than one kitchen.",
      ctaTitle: "Ready to see how it works in your kitchen?",
      ctaSubtitle:
        "Connect with our team. We'll review your current operation, answer your questions and confirm whether FnB Cost Pro is the right fit.",
      getStartedFree: "Schedule a Culinary Review",
      tierLabels: { free: "Free", basic: "Starter", pro: "Pro" },
      sections: [
        {
          key: "setup",
          label: "Build the Starting Map",
          badge: "All paid plans",
          headline: "Turn your existing materials into a working food cost system",
          body: "Most operators already have the raw data — a printed menu, recipe cards, vendor invoices. FnB Cost Pro reads these from photos so you can build a working cost system without weeks of manual data entry. Your team reviews and confirms the extracted data before anything is saved.",
          items: [
            {
              title: "Menu Scan",
              desc: "Photograph your printed menu — dish names, sections, and prices are extracted and used to seed your recipe library. Works with printed menus, PDF screenshots, and handwritten specials. Your team reviews and confirms the extracted items before anything is saved.",
              stat: "A 50-item menu typically takes 2–5 minutes to review and confirm vs. 12–25 hours of manual entry",
            },
            {
              title: "Recipe Scan",
              desc: "Point your phone at a recipe card or printed cooking sheet. Ingredients, quantities, and units are read from the photo and matched to your inventory — then your team reviews the match and cost before the recipe is saved.",
              stat: "Each recipe typically takes seconds to capture vs. 15–30 minutes of manual entry",
            },
            {
              title: "Invoice Scan",
              desc: "Photograph a vendor invoice and line items are extracted and matched to your inventory items for review. Your team confirms the matches and pricing updates before anything is applied.",
              stat: "Each delivery typically takes 1–2 minutes to review vs. 20 minutes of manual re-keying",
            },
          ],
        },
        {
          key: "count",
          label: "Keep Costs Current",
          badge: "Pro plan",
          headline: "Replace the clipboard with your phone for periodic counts",
          body: "Physical inventory counting is one of the most time-consuming recurring tasks in any restaurant. FnB Cost Pro's Pro tier gives your team a faster, more structured way to count by location.",
          items: [
            {
              title: "Shelf Scan",
              desc: "Walk your coolers, freezer, and dry storage with your phone. Product labels are read and counts logged to your active count session — organized by storage location. Your team reviews the session before finalizing.",
              stat: "May reduce count time significantly — exact savings vary by operation size and storage layout",
            },
            {
              title: "Catch-Weight Scanning",
              desc: "For proteins and items sold by weight, photograph the scale readout alongside the item. Both the item identity and exact weight are captured in one step for your team to review.",
              stat: "Reduces the most error-prone part of a protein count",
            },
          ],
        },
        {
          key: "manage",
          label: "Find the Gap Between Expected and Actual",
          badge: "All paid plans",
          headline: "Understand where your food cost goes — and where it should be",
          body: "Once your data is in, FnB Cost Pro keeps recipe costs current as vendor prices change and gives you tools to compare what you should have spent against what you actually spent.",
          items: [
            {
              title: "Live Recipe Costing",
              desc: "Every recipe shows a live food cost per portion that recalculates when a vendor price changes. Nested sub-recipes recalculate in the correct dependency order. Reduce manual updates as your vendor relationships mature.",
            },
            {
              title: "Theoretical Food Cost Variance Reporting",
              desc: "Theoretical Food Cost shows what you should have spent based on what you sold. Compare it to what you actually spent to surface signs of waste, over-portioning, or shrinkage by category.",
            },
            {
              title: "Multi-Location Management",
              desc: "Manage inventory, recipes, par levels, and vendor access across every location from one account. Pro adds transfer orders between stores and cross-location variance reporting.",
            },
            {
              title: "Vendor & Order Guides",
              desc: "Import order guides from Sysco, GFS, US Foods, and any major distributor. When vendor pricing updates, recipe costs are recalculated. Pro adds cross-shop pricing comparison to help surface better pricing across vendors.",
            },
          ],
        },
      ],
      guaranteeSection: {
        title: "The 14-Day Food Cost Opportunity Guarantee",
        body: "Start your trial, follow the guided launch, and FnB Cost Pro will help you identify at least one area where your food cost may have an improvement opportunity — whether that's a recipe cost you haven't reviewed, a vendor price that has quietly increased, an inventory variance that points to waste, or a portion size that no longer matches your costed recipe.",
        disclaimer: "This is a genuine offer, not a marketing promise. 'Opportunity' means a specific area where food cost may be improvable — not a guaranteed dollar saving. Results depend on the accuracy of data you bring and your team's willingness to review what we surface.",
      },
      whatYouBringSection: {
        title: "What You Bring to the 14-Day Review",
        bullets: [
          "Your current menu (printed, PDF, or photo of a chalkboard)",
          "Recent vendor invoices — at least a few weeks of deliveries",
          "Recipe cards or notes — handwritten is fine",
          "One manager or owner who can spend 2–3 hours over the 14 days reviewing what we surface",
          "Willingness to review at least one opportunity area with your team",
        ],
      },
      opportunitiesSection: {
        title: "What Kind of Savings Opportunity Might We Find?",
        subtitle: "Every operation is different. Here are 8 common types of food cost opportunities FnB Cost Pro is designed to help surface:",
        bullets: [
          "A recipe cost that has drifted above your target margin because of vendor price increases",
          "An inventory variance that points to waste, portioning gaps, or unrecorded usage",
          "A vendor price that is higher than a comparable item in a different order guide",
          "A high-volume item whose portion size no longer matches the costed recipe",
          "A category where actual spend is consistently higher than theoretical",
          "A prep item whose yield is lower than assumed in the recipe cost",
          "A menu item priced below cost because the recipe cost was never updated",
          "A storage process that is generating preventable spoilage",
        ],
      },
      groups: [
        {
          title: "Build the Starting Map",
          description:
            "Turn your menus, recipe cards, and vendor invoices into a structured food cost system — using photos instead of keyboards. Your team reviews and confirms the extracted data before anything is saved.",
          features: [
            "Menu scan: extract dish names, sections, and prices from a photo of your printed menu",
            "Recipe scan: capture ingredients, quantities, and units from a recipe card photo",
            "Invoice scan: extract vendor line items from a photo and match them to your inventory for review",
            "Works with printed menus, PDFs, handwritten cards, and digital screenshots",
            "Team reviews and confirms all extracted data before it is saved",
          ],
        },
        {
          title: "Keep Costs Current",
          description:
            "Vendor price changes flow through to recipe costs. Count inventory by location on your phone. Keep your food cost data current without rebuilding it from scratch every week.",
          features: [
            "Live recipe costing that recalculates when vendor prices change",
            "Nested sub-recipe support for multi-step preparations",
            "Per-recipe yield override for items with different waste factors in different dishes",
            "Shelf scan: count from product labels by storage location on your phone (Pro)",
            "Catch-weight scanning for proteins and by-weight items (Pro)",
            "Vendor order guide imports from Sysco, GFS, US Foods, and major distributors",
          ],
        },
        {
          title: "Find the Gap Between Expected and Actual",
          description:
            "Theoretical Food Cost variance reporting shows what you should have spent based on what you sold — and lets you compare it to what you actually spent by category, location, and time period.",
          features: [
            "Theoretical Food Cost calculated from your POS sales and recipe costs",
            "Compare theoretical vs. actual food cost by category",
            "Surface signs of waste, over-portioning, or shrinkage where they appear in the data",
            "Date-range reporting to track food cost trends over time",
            "Works with most POS systems — import sales data from the system you already use",
            "Cross-location variance reporting to compare performance across stores (Pro)",
          ],
        },
        {
          title: "Scale the System",
          description:
            "Multi-location management, transfer orders, cross-shop vendor pricing, and QuickBooks export. The tools that scale when your operation grows — without rebuilding your cost system from scratch.",
          features: [
            "Manage multiple locations under one company account",
            "Per-store inventory, par levels, and vendor access",
            "Transfer orders between locations (Pro)",
            "Cross-shop vendor pricing: compare the same item across all order guides (Pro)",
            "Role-based access: admin, manager, and staff tiers",
            "QuickBooks export for received purchase orders (Pro)",
          ],
        },
      ],
    },
    pricing: {
      meta: {
        title: "Pricing — FnB Cost Pro Culinary Operations Platform",
        description:
          "One platform for chef-led restaurants and F&B operations. Vendor connectivity, live recipe costing, and inventory intelligence included. First operation included in the subscription. Contact us for transparent starting rates.",
      },
      badge: "One Platform. Every Operation.",
      headline: "Built for the way chefs work.",
      subheadline:
        "FnB Cost Pro is a single platform subscription — vendor connectivity, live recipe costing, and inventory intelligence are part of how it works, not optional add-ons. Your first operation is included.",
      monthly: "Monthly",
      annual: "Annual",
      annualSavings: "Save ~14%",
      platform: {
        label: "FnB Cost Pro Platform",
        tagline: "The complete culinary operations system for chef-led restaurants and F&B teams.",
        firstLocation: "First operation included",
        from: "from",
        monthlyPrice: "$149",
        annualPrice: "$129",
        perMonth: "/month",
        perMonthAnnual: "/month, billed annually",
        cta: "Schedule a Culinary Review",
        ctaNote: "Independent chefs and smaller groups — ask about transparent starting rates when you connect.",
        features: [
          "Menu scan — extract dish names, sections, and prices from a photo",
          "Recipe scan — photograph recipe cards and get costed recipes instantly",
          "Invoice scan — capture vendor line items and auto-match to inventory",
          "Live recipe costing — unit costs update when vendor prices change",
          "Nested sub-recipe support — recalculates in the correct dependency order",
          "Vendor order guide imports — Sysco, GFS, US Foods, and more",
          "Account-specific vendor pricing from supported portals and uploaded files",
          "Purchase orders and receiving workflows — track deliveries and cost changes",
          "Shelf scan — count inventory by location using your phone camera",
          "Theoretical Food Cost variance reporting — actual vs. expected",
          "POS sales data integration",
          "Transfer orders between locations",
          "Cross-location variance reporting and analytics",
          "Multi-seat team access with role-based permissions",
          "QuickBooks export for received purchase orders",
        ],
      },
      addOns: {
        locations: {
          label: "Additional Locations",
          tagline: "Each additional operation gets full platform access plus cross-location capabilities.",
          monthlyPrice: "$149/month",
          annualPrice: "$129/month, billed annually",
          cta: "Ask about multi-location",
          features: [
            "Full platform access per location",
            "Cross-location variance reporting",
            "Transfer orders between locations",
            "Cross-shop vendor price comparison",
            "Consolidated management view",
          ],
        },
        implementation: {
          label: "Guided Implementation",
          tagline: "Structured onboarding, data migration, configuration, and team training — done with you, not handed off.",
          price: "One-time engagement",
          cta: "Schedule a Culinary Review",
          features: [
            "Account configuration and initial setup",
            "Menu, recipe, and inventory migration",
            "Vendor portal and order guide connections",
            "Team training session",
            "Launch readiness review",
          ],
        },
        enterprise: {
          label: "Enterprise Operations",
          tagline: "For clubs, resorts, hotels, and complex multi-outlet environments that need tailored scope and pricing.",
          price: "Custom scope and pricing",
          cta: "Schedule a Culinary Review",
          features: [
            "Custom operational scope and configuration",
            "Multi-brand or multi-outlet hierarchy",
            "Enterprise integrations and API access",
            "SLA-backed support",
            "Dedicated implementation lead",
          ],
        },
      },
      faqTitle: "Common Questions",
      faqItems: [
        {
          q: "What's included in the platform subscription?",
          a: "The platform subscription includes everything: menu scan, recipe scan, invoice scan, live recipe costing with nested sub-recipes, vendor order guide imports, account-specific vendor pricing, inventory counting workflows, POS integration, transfer orders, cross-location reporting, and multi-seat team access with role-based permissions. Vendor connectivity is how the platform moves pricing, catalog, invoice, and order data — it is a core capability, not a separately priced feature.",
        },
        {
          q: "Is vendor connectivity included? What does that mean?",
          a: "Yes, vendor connectivity is included in every platform subscription. It covers capturing account-specific pricing from supported distributor portals, importing order guides from Sysco, GFS, US Foods, and other distributors, invoice scan with automatic line-item matching, and purchase order and receiving workflows. This is how the platform keeps vendor pricing, catalog, and order data in sync — it is part of the product, not an add-on.",
        },
        {
          q: "How are additional locations priced?",
          a: "Each additional operation or location is priced separately beyond the first location that is included in the platform subscription. Additional locations get full platform access plus cross-location capabilities: consolidated reporting, transfer orders, and cross-shop vendor price comparison. Connect with our team to confirm the structure for your operation.",
        },
        {
          q: "What is Guided Implementation, and is it required?",
          a: "Guided Implementation is a structured onboarding engagement where our team works with yours to configure the account, migrate existing menu and recipe data, connect vendor portals and order guides, and train your team. It is strongly recommended — especially for operations with established vendor relationships or existing recipe libraries. It is priced separately as a one-time engagement rather than bundled into the subscription, so the scope reflects your operation.",
        },
        {
          q: "When does Enterprise Operations apply?",
          a: "Enterprise Operations is designed for clubs, resorts, hotels, and complex multi-outlet environments where standard per-location pricing doesn't reflect the operational scope. These operations often involve multiple F&B outlets, banquet and events production, multiple POS systems, or custom reporting requirements. We scope and price these engagements individually.",
        },
        {
          q: "Is there early adopter pricing?",
          a: "Yes — we offer founder pricing for our first 50 accounts. Reach out via the Contact page to ask about it. We keep specific rates off the public pricing page intentionally to give early customers a meaningful advantage.",
        },
        {
          q: "Can I start with one location and add more later?",
          a: "Yes. The platform subscription includes your first operation. As your operation grows, additional locations are added to the subscription at the per-location rate. Connect with our team when you're ready to expand.",
        },
      ],
      ctaTitle: "Ready to see how it works in your kitchen?",
      ctaBody: "Connect with our team. We'll walk through your current operation, answer your questions, and confirm whether FnB Cost Pro is the right fit — before you commit to anything.",
      ctaButton: "Schedule a Culinary Review",
    },
    about: {
      meta: {
        title: "About FnB Cost Pro — The Kitchen Should Not Have to Adapt to the Software",
        description:
          "FnB Cost Pro is built for chef-led restaurants and professional F&B operations. Culinary operations intelligence — inventory, recipe costing, and vendor connectivity — without adding administrative burden.",
      },
      badge: "Our Story",
      headline: "We Help Restaurants Find Food Cost Opportunities Faster",
      subheadline:
        "FnB Cost Pro started with a simple frustration: restaurant operators were spending too much time typing menus, recipes, invoices, and inventory counts into software before they could see anything useful.",
      storyBody:
        "We built FnB Cost Pro to change that. By replacing much of the keyboard work with photo-based setup, operators can get to food cost visibility faster — starting with a guided 14-day process designed to identify at least one savings opportunity.",
      missionTitle: "Our Mission",
      mission1:
        "Food & Beverage is one of the most margin-sensitive industries in the world. A 1–2% shift in food cost can be the difference between a profitable month and a loss. For a restaurant doing $500,000 per year, every 1% improvement in food cost represents $5,000 annually.",
      mission2:
        "Yet most operators still lack a fast, practical way to turn menus, recipes, vendor invoices, and inventory counts into usable food cost insight. Our mission is to help operators find those opportunities faster.",
      mission3:
        "The operator points the camera. FnB Cost Pro extracts the data, structures it, and helps the team review, confirm, and act.",
      valuesLabel: "Our Values",
      valuesTitle: "What Drives Us",
      values: [
        {
          title: "Built for Operators, by Operators",
          body: "Every feature in FnB Cost Pro is designed around real restaurant workflows: late-night inventory counts, vendor price changes, handwritten recipes, and the pressure to protect margin without adding admin work.",
        },
        {
          title: "Food Cost Visibility Before Busywork",
          body: "Operators should not have to spend weeks typing data before they can see where food cost may be leaking. FnB Cost Pro uses photo-based setup to get restaurants to insight faster.",
        },
        {
          title: "Guided to the First Opportunity",
          body: "Software alone does not fix food cost. FnB Cost Pro pairs fast setup with a guided 14-day process designed to identify at least one food cost savings opportunity.",
        },
        {
          title: "Practical, Not Perfect",
          body: "Restaurant data is messy. Menus change, invoices vary, recipes live on cards and clipboards. FnB Cost Pro is built to help operators turn imperfect data into useful decisions.",
        },
      ],
      whoLabel: "Who We're Built For",
      whoTitle: "Built for Operators Who Need Food Cost Visibility Without More Admin Work",
      whoSubtitle:
        "Whether you're running one location or many, FnB Cost Pro is designed for operations where food cost matters and time is short.",
      whoItems: [
        {
          title: "Independent Restaurants",
          body: "FnB Cost Pro Starter helps single-location operators scan menus, cost recipes, review invoices, and start identifying food cost opportunities without hiring an admin person.",
        },
        {
          title: "Multi-Unit Groups",
          body: "Two locations or twenty. Use location-level reporting to compare where food cost, waste, vendor pricing, or recipe variance may be drifting. Billed per location so costs scale with your operation.",
        },
        {
          title: "Bars & Beverage Operations",
          body: "Track beverage recipes, vendor costs, and variance using the same photo-first workflow. Pour cost by recipe, variance tracking, and vendor order guides for spirits, beer, wine, and NA beverages.",
        },
        {
          title: "Catering & Event F&B",
          body: "Recipe costing for variable-quantity production. Build event recipes, cost them per head, and track ingredient costs against catering revenue.",
        },
        {
          title: "Ghost Kitchens & Dark Kitchens",
          body: "Multi-concept operations under one roof. Manage separate recipe libraries and inventory costs per concept from one FnB Cost Pro account.",
        },
        {
          title: "Hotel & Resort F&B",
          body: "Multiple outlets, complex menus, and tight budget accountability. Enterprise plan supports multi-brand management, custom integrations, and SLA-backed support.",
        },
      ],
      ctaTitle: "Ready to Find Your First Food Cost Opportunity?",
      ctaSubtitle:
        "Start your 14-day Food Cost Opportunity Review. Scan your menu, review your invoices, and let FnB Cost Pro help identify at least one area where food cost may be leaking.",
      getStartedFree: "Start Your 14-Day Opportunity Review",
      ctaSecondary: "Scan Your Menu",
    },
    contact: {
      meta: {
        title: "Contact — FnB Cost Pro",
        description: "Get in touch with the FnB Cost Pro team. Questions about pricing, onboarding, or how FnB Cost Pro can help your operation.",
      },
      badge: "Get in Touch",
      headline: "Contact Us",
      subheadline: "Have a question, want a demo, or need help choosing the right plan? We'd love to hear from you.",
      contactTitle: "Reach out directly",
      contactDesc: "Send us a message and we'll get back to you within one business day.",
      emailLabel: "Email",
      responseLabel: "Response time",
      responseDesc: "We typically respond within one business day.",
      validationName: "Name must be at least 2 characters",
      validationEmail: "Please enter a valid email address",
      validationMessage: "Message must be at least 10 characters",
      sendFailedDefault: "Failed to send your message. Please try again.",
      sendFailedTitle: "Failed to send",
      successTitle: "Message sent!",
      successDesc: "Thanks for reaching out. We'll be in touch shortly.",
      sendAnother: "Send another message",
      nameLabel: "Name",
      namePlaceholder: "Your name",
      emailFormLabel: "Email",
      emailPlaceholder: "your@email.com",
      companyLabel: "Restaurant / Company",
      companyPlaceholder: "Your restaurant name",
      messageLabel: "Message",
      messagePlaceholder: "Tell us about your operation, or just say hello…",
      submitting: "Sending…",
      submitButton: "Send Message",
    },
  },

  es: {
    nav: {
      features: "Funciones",
      pricing: "Precios",
      about: "Nosotros",
      contact: "Contacto",
      login: "Iniciar sesión",
      getStarted: "Comenzar",
      myAccount: "Mi cuenta",
      goToDashboard: "Ir al panel",
      signOut: "Cerrar sesión",
      signingOut: "Cerrando sesión…",
    },
    footer: {
      tagline: "Gestión de inventario foto-primero y costeo de recetas para restaurantes y negocios de Alimentos y Bebidas.",
      product: "Producto",
      getStarted: "Comenzar",
      getStartedFree: "Comenzar",
      login: "Iniciar sesión",
      viewPricing: "Ver precios",
      company: "Empresa",
      about: "Nosotros",
      contact: "Contacto",
      rights: "Todos los derechos reservados.",
      privacy: "Política de privacidad",
      terms: "Términos de servicio",
    },
    home: {
      meta: {
        title: "FnB Cost Pro — Inteligencia de Operaciones Culinarias para Restaurantes Liderados por Chefs",
        description:
          "FnB Cost Pro aporta inteligencia de inventario, costeo de recetas en vivo y conectividad con proveedores a restaurantes liderados por chefs y operaciones de A&B. Construido para la forma en que trabajan las cocinas profesionales.",
      },
      badge: "Inteligencia de Operaciones Culinarias",
      headline: "Construida para la forma en que los chefs trabajan.",
      subheadline:
        "Convierte recetas escritas a mano, fotos, facturas y archivos existentes en costos de recetas precisos, inteligencia de inventario y compras más inteligentes — sin sobrecargar a tu equipo culinario con entrada de datos.",
      ctaPrimary: "Agendar una Revisión Culinaria",
      ctaSecondary: "Cómo Funciona",
      workflowLabel: "Cómo funciona",
      workflowItems: [
        { step: "Captura", phrase: "Fotos, archivos y cargas — sin re-entrada de datos" },
        { step: "Costea", phrase: "Recetas con precio desde datos de proveedores en vivo" },
        { step: "Compara", phrase: "Teórico vs. real — ve exactamente dónde se desvían los costos" },
        { step: "Predice", phrase: "Recomendaciones de pedidos cuando tienes el historial para respaldarlas" },
      ],
      captureLabel: "Qué Puedes Capturar",
      captureTitle: "De la foto de un chef a datos operacionales estructurados.",
      captureCards: [
        {
          input: "Receta escrita a mano",
          outputs: [
            "Ingredientes y cantidades estructurados",
            "Rendimiento, porciones y escalado",
            "Costo actual de receta con precios de proveedor en vivo",
          ],
        },
        {
          input: "Factura o guía de pedidos",
          outputs: [
            "Artículos de proveedor y tamaños de empaque",
            "Precio de entrega por unidad",
            "Historial de precios y seguimiento de cambios",
          ],
        },
        {
          input: "Hoja de inventario",
          outputs: [
            "Artículos de inventario y conteos",
            "Asignaciones de ubicación de almacenamiento",
            "Datos históricos de conteo y valor",
          ],
        },
        {
          input: "Etiqueta de producto o caja",
          outputs: [
            "Identidad y descripción del producto",
            "Unidades, geometría de empaque y peso de captura",
            "Emparejamiento y vinculación con artículo de proveedor",
          ],
        },
      ],
      captureSummary:
        "Recetas, inventario, proveedores, precios y compras previstas permanecen conectados en toda la operación.",
      purchasingLabel: "Inteligencia de Compras",
      purchasingTitle: "Precios actuales. Comparaciones válidas. Pedidos más inteligentes.",
      purchasingBody:
        "Captura precios de proveedores específicos de tu cuenta desde portales compatibles y archivos existentes. Compara precios en vivo entre tus distribuidores e identifica dónde una guía de pedidos se ha movido respecto a tus costos de recetas.",
      purchasingBullets: [
        "Precios específicos de cuenta desde portales de distribuidores compatibles",
        "Importación de guías de pedidos de Sysco, GFS, US Foods y distribuidores principales",
        "El escaneo de facturas captura los precios entregados por cada línea",
        "Comparación entre proveedores cuando hay precios disponibles de múltiples guías",
        "Los costos de recetas se actualizan automáticamente cuando cambian los precios",
        "Flujos de órdenes de compra y recepción conectados al inventario",
      ],
      purchasingCta: "Agendar una Revisión Culinaria",
      multiLabel: "Multi-Sucursal",
      multiTitle: "Cada cocina, almacén y punto de venta conectados.",
      multiBody:
        "Modela el almacenamiento central, el inventario de sucursales y las ubicaciones de artículos compartidos. Las recetas y los costos permanecen consistentes en toda la operación — con conteos por sucursal y reportes de varianza que muestran dónde está cada cocina.",
      multiBullets: [
        "Inventario central y de sucursales modelado por separado o en conjunto",
        "Ubicaciones de artículos compartidas entre áreas de almacenamiento y puntos de venta",
        "Conteos y reportes de varianza por sucursal",
        "Costos de recetas consistentes en toda la operación",
        "Acceso basado en roles para administración, gerencia y personal de cocina",
        "Una cuenta — toda la operación visible en un solo lugar",
      ],
      onboardingTitle: "Comienza con la operación que ya tienes",
      onboardingItems: [
        "Trae tus menús existentes, tarjetas de recetas, facturas o guías de pedidos",
        "Captúralos por foto, carga o archivo — sin re-entrada de datos",
        "Tu equipo revisa y confirma cada artículo extraído antes de guardarlo",
        "Los costos comienzan a conectarse a medida que los datos de proveedores y recetas se alinean",
        "Una sesión de Revisión Culinaria te ayuda a interpretar lo que los datos te dicen",
      ],
      onboardingCta: "Agendar una Revisión Culinaria",
      ctaBottomTitle: "¿Listo para ver cómo funciona en tu cocina?",
      ctaBottomBody:
        "Conéctate con nuestro equipo. Revisaremos tu operación actual, responderemos tus preguntas y confirmaremos si FnB Cost Pro es la opción correcta — antes de que te comprometas con algo.",
      ctaBottomButton: "Agendar una Revisión Culinaria",
    },
    features: {
      meta: {
        title: "Funcionalidades de la Plataforma — FnB Cost Pro Plataforma de Operaciones Culinarias",
        description:
          "Explora las capacidades de FnB Cost Pro: escaneo de menú, costeo de recetas, captura de facturas, conteo de inventario, conectividad con proveedores y gestión multi-sucursal.",
      },
      badge: "Menos Entrada. Más Inteligencia.",
      headline: "De la foto de un chef a datos operacionales estructurados.",
      subheadline:
        "FnB Cost Pro convierte tus menús, tarjetas de recetas, facturas de proveedores y materiales de inventario existentes en datos operacionales estructurados — capturados por foto o archivo, revisados por tu equipo antes de guardar cualquier cosa.",
      badgesNote: "las insignias indican qué plan incluye cada función",
      startFree: "Agendar una Revisión Culinaria",
      heroSecondaryCtaLabel: "Cómo Funciona",
      heroProofLine: "",
      upgradeTitle: "La plataforma se adapta a la forma en que funciona tu operación",
      upgradeSubtitle: "Todo en una sola suscripción. El alcance crece con tu operación.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Operación Individual",
      upgradeStarterBody:
        "Configuración por foto, costeo de recetas en vivo, importación de guías de pedidos, flujos de conteo de inventario, reportes de varianza del Costo Teórico de Alimentos y acceso multi-usuario. Todo lo que necesitas para una cocina bien administrada.",
      upgradeBasicTitle: "Operación Individual",
      upgradeBasicBody:
        "Configuración por foto, costeo de recetas en vivo, importación de guías de pedidos, flujos de conteo de inventario, reportes de varianza del Costo Teórico de Alimentos y acceso multi-usuario. Todo lo que necesitas para una cocina bien administrada.",
      upgradeProTitle: "Multi-Operación",
      upgradeProBody:
        "Todo lo de Operación Individual más escaneo de estantes por teléfono, reportes de varianza entre sucursales, comparación de precios entre proveedores, órdenes de transferencia y exportación a QuickBooks. Para operaciones que gestionan más de una cocina.",
      ctaTitle: "¿Listo para ver cómo funciona en tu cocina?",
      ctaSubtitle:
        "Conéctate con nuestro equipo. Revisaremos tu operación actual, responderemos tus preguntas y confirmaremos si FnB Cost Pro es la opción correcta.",
      getStartedFree: "Agendar una Revisión Culinaria",
      tierLabels: { free: "Gratis", basic: "Starter", pro: "Pro" },
      sections: [],
      guaranteeSection: {
        title: "La Garantía de Oportunidad de Costos de 14 Días",
        body: "Inicia tu prueba, sigue el lanzamiento guiado y FnB Cost Pro te ayudará a identificar al menos un área donde tus costos de alimentos pueden tener una oportunidad de mejora — ya sea un costo de receta sin revisar, un precio de proveedor que ha subido silenciosamente, una varianza de inventario que apunta a desperdicio, o una porción que ya no coincide con la receta costeada.",
        disclaimer: "Esta es una oferta genuina, no una promesa de marketing. 'Oportunidad' significa un área específica donde el costo de alimentos puede ser mejorable — no un ahorro garantizado en dinero. Los resultados dependen de la precisión de los datos que aportes y la disposición de tu equipo para revisar lo que mostramos.",
      },
      whatYouBringSection: {
        title: "Qué Aportas a la Revisión de 14 Días",
        bullets: [
          "Tu menú actual (impreso, PDF o foto de una pizarra)",
          "Facturas recientes de proveedores — al menos unas pocas semanas de entregas",
          "Tarjetas de recetas o notas — escritas a mano está bien",
          "Un gerente o propietario que pueda dedicar 2–3 horas durante los 14 días para revisar lo que mostramos",
          "Disposición para revisar al menos un área de oportunidad con tu equipo",
        ],
      },
      opportunitiesSection: {
        title: "¿Qué Tipo de Oportunidad de Ahorro Podríamos Encontrar?",
        subtitle: "Cada operación es diferente. Aquí hay 8 tipos comunes de oportunidades de costos que FnB Cost Pro está diseñado para ayudar a identificar:",
        bullets: [
          "Un costo de receta que ha superado tu margen objetivo por aumentos de precios de proveedores",
          "Una varianza de inventario que apunta a desperdicio, brechas de porciones o uso no registrado",
          "Un precio de proveedor que es más alto que un artículo comparable en otra guía de pedidos",
          "Un artículo de alto volumen cuya porción ya no coincide con la receta costeada",
          "Una categoría donde el gasto real es consistentemente mayor que el teórico",
          "Un artículo de preparación cuya merma es menor de lo asumido en el costo de la receta",
          "Un artículo del menú con precio por debajo del costo porque el costo de la receta nunca fue actualizado",
          "Un proceso de almacenamiento que genera desperdicio prevenible",
        ],
      },
      groups: [
        {
          title: "Construye el Mapa Inicial",
          description:
            "Convierte tus menús, tarjetas de recetas y facturas de proveedores en un sistema de costos estructurado — usando fotos en lugar de teclados. Tu equipo revisa y confirma los datos extraídos antes de guardar cualquier cosa.",
          features: [
            "Escaneo de menú: extrae nombres de platos, secciones y precios de una foto de tu menú",
            "Escaneo de recetas: captura ingredientes, cantidades y unidades de una foto de tarjeta",
            "Escaneo de facturas: extrae líneas de proveedor de una foto y emparéjalas con tu inventario",
            "Funciona con menús impresos, PDFs, tarjetas escritas a mano y capturas digitales",
            "El equipo revisa y confirma todos los datos extraídos antes de guardar",
          ],
        },
        {
          title: "Mantén los Costos Actualizados",
          description:
            "Los cambios de precios de proveedores fluyen a los costos de recetas. Cuenta el inventario por ubicación desde tu teléfono. Mantén tus datos de costos actualizados sin reconstruirlos cada semana.",
          features: [
            "Costeo de recetas en vivo que recalcula cuando cambian los precios de proveedores",
            "Soporte de sub-recetas anidadas para preparaciones de varios pasos",
            "Ajuste de merma por receta para artículos con diferentes factores de desperdicio",
            "Escaneo de estantes: cuenta por etiquetas y ubicación desde tu teléfono (Pro)",
            "Escaneo de peso-captura para proteínas y artículos por peso (Pro)",
            "Importación de guías de proveedores de Sysco, GFS, US Foods y distribuidores principales",
          ],
        },
        {
          title: "Encuentra la Brecha Entre lo Esperado y lo Real",
          description:
            "Los reportes de varianza del Costo Teórico de Alimentos muestran lo que deberías haber gastado según lo que vendiste — y te permiten compararlo con lo que realmente gastaste por categoría, sucursal y período de tiempo.",
          features: [
            "Costo Teórico de Alimentos calculado desde ventas de POS y costos de recetas",
            "Compara el costo teórico vs. real por categoría",
            "Señales de desperdicio, sobre-porciones o merma donde aparecen en los datos",
            "Informes por rango de fechas para rastrear tendencias de costos",
            "Funciona con la mayoría de sistemas POS — importa datos del sistema que ya usas",
            "Reporte de varianza entre sucursales (Pro)",
          ],
        },
        {
          title: "Escala el Sistema",
          description:
            "Gestión multi-sucursal, órdenes de transferencia, comparación de precios entre proveedores y exportación a QuickBooks. Las herramientas que escalan cuando tu operación crece.",
          features: [
            "Gestiona múltiples sucursales bajo una cuenta",
            "Inventario, niveles de stock y acceso a proveedores por tienda",
            "Órdenes de transferencia entre sucursales (Pro)",
            "Comparación de precios entre proveedores: compara el mismo artículo en todas las guías (Pro)",
            "Acceso basado en roles: administrador, gerente y personal",
            "Exportación a QuickBooks para órdenes de compra recibidas (Pro)",
          ],
        },
      ],
    },
    pricing: {
      meta: {
        title: "Precios — FnB Cost Pro Plataforma de Operaciones Culinarias",
        description:
          "Una plataforma para restaurantes liderados por chefs y operaciones de A&B. Conectividad con proveedores, costeo de recetas en vivo e inteligencia de inventario incluidos. Primera operación incluida en la suscripción.",
      },
      badge: "Una Plataforma. Cada Operación.",
      headline: "Construida para la forma en que los chefs trabajan.",
      subheadline:
        "FnB Cost Pro es una sola suscripción de plataforma — la conectividad con proveedores, el costeo de recetas en vivo y la inteligencia de inventario forman parte de cómo funciona, no son complementos opcionales. Tu primera operación está incluida.",
      monthly: "Mensual",
      annual: "Anual",
      annualSavings: "Ahorra ~14%",
      platform: {
        label: "Plataforma FnB Cost Pro",
        tagline: "El sistema completo de operaciones culinarias para restaurantes liderados por chefs y equipos de A&B.",
        firstLocation: "Primera operación incluida",
        from: "desde",
        monthlyPrice: "$149",
        annualPrice: "$129",
        perMonth: "/mes",
        perMonthAnnual: "/mes, facturado anualmente",
        cta: "Agendar una Revisión Culinaria",
        ctaNote: "Chefs independientes y grupos más pequeños — pregunta sobre precios de inicio transparentes cuando te conectes.",
        features: [
          "Escaneo de menú — extrae nombres de platillos, secciones y precios desde una foto",
          "Escaneo de recetas — fotografía tarjetas de recetas y obtén recetas con costos al instante",
          "Escaneo de facturas — captura líneas de proveedores y concílalas automáticamente con el inventario",
          "Costeo de recetas en vivo — los costos unitarios se actualizan cuando cambian los precios de proveedores",
          "Sub-recetas anidadas — recalcula en el orden de dependencia correcto",
          "Importación de guías de pedidos — Sysco, GFS, US Foods y más",
          "Precios de proveedores específicos de cuenta desde portales compatibles y archivos cargados",
          "Órdenes de compra y flujos de recepción — rastrea entregas y cambios de costo",
          "Escaneo de estantes — cuenta el inventario por ubicación usando la cámara de tu teléfono",
          "Reportes de varianza del Costo Teórico de Alimentos — real vs. esperado",
          "Integración de datos de ventas POS",
          "Órdenes de transferencia entre sucursales",
          "Reportes de varianza y análisis entre ubicaciones",
          "Acceso multi-usuario con permisos basados en roles",
          "Exportación a QuickBooks para órdenes de compra recibidas",
        ],
      },
      addOns: {
        locations: {
          label: "Ubicaciones Adicionales",
          tagline: "Cada operación adicional obtiene acceso completo a la plataforma más capacidades entre ubicaciones.",
          monthlyPrice: "$149/mes",
          annualPrice: "$129/mes, facturado anualmente",
          cta: "Preguntar sobre múltiples ubicaciones",
          features: [
            "Acceso completo a la plataforma por ubicación",
            "Reportes de varianza entre ubicaciones",
            "Órdenes de transferencia entre sucursales",
            "Comparación de precios entre proveedores",
            "Vista consolidada de gestión",
          ],
        },
        implementation: {
          label: "Implementación Guiada",
          tagline: "Incorporación estructurada, migración de datos, configuración y capacitación del equipo — contigo, no delegado.",
          price: "Compromiso único",
          cta: "Agendar una Revisión Culinaria",
          features: [
            "Configuración de cuenta e inicio",
            "Migración de menú, recetas e inventario",
            "Conexiones de portal de proveedores y guías de pedidos",
            "Sesión de capacitación para el equipo",
            "Revisión de preparación para el lanzamiento",
          ],
        },
        enterprise: {
          label: "Operaciones Enterprise",
          tagline: "Para clubes, resorts, hoteles y entornos multi-sucursal complejos que necesitan alcance y precios personalizados.",
          price: "Alcance y precios personalizados",
          cta: "Agendar una Revisión Culinaria",
          features: [
            "Alcance y configuración operacional personalizada",
            "Jerarquía multi-marca o multi-sucursal",
            "Integraciones Enterprise y acceso API",
            "Soporte con respaldo de SLA",
            "Líder de implementación dedicado",
          ],
        },
      },
      faqTitle: "Preguntas Frecuentes",
      faqItems: [
        {
          q: "¿Qué está incluido en la suscripción de la plataforma?",
          a: "La suscripción de la plataforma incluye todo: escaneo de menú, escaneo de recetas, escaneo de facturas, costeo de recetas en vivo con sub-recetas anidadas, importación de guías de proveedores, precios de proveedores específicos de cuenta, flujos de conteo de inventario, integración POS, órdenes de transferencia, reportes entre ubicaciones y acceso multi-usuario con permisos basados en roles. La conectividad con proveedores es cómo la plataforma mueve datos de precios, catálogo, facturas y pedidos — es una capacidad central, no una función con precio separado.",
        },
        {
          q: "¿Está incluida la conectividad con proveedores? ¿Qué significa eso?",
          a: "Sí, la conectividad con proveedores está incluida en cada suscripción de plataforma. Abarca la captura de precios específicos de cuenta desde portales de distribuidores compatibles, importación de guías de pedidos de Sysco, GFS, US Foods y otros distribuidores, escaneo de facturas con conciliación automática de líneas y flujos de órdenes de compra y recepción. Así es como la plataforma mantiene sincronizados los datos de precios, catálogo y pedidos de proveedores.",
        },
        {
          q: "¿Cómo se cobran las ubicaciones adicionales?",
          a: "Cada operación o ubicación adicional tiene un precio separado más allá de la primera ubicación incluida en la suscripción de la plataforma. Las ubicaciones adicionales obtienen acceso completo a la plataforma más capacidades entre ubicaciones. Conéctate con nuestro equipo para confirmar la estructura para tu operación.",
        },
        {
          q: "¿Qué es la Implementación Guiada y es obligatoria?",
          a: "La Implementación Guiada es un compromiso de incorporación estructurada donde nuestro equipo trabaja con el tuyo para configurar la cuenta, migrar datos de menú y recetas existentes, conectar portales de proveedores y guías de pedidos, y capacitar a tu equipo. Es muy recomendada, especialmente para operaciones con relaciones establecidas con proveedores o bibliotecas de recetas existentes. Se cotiza por separado como un compromiso único.",
        },
        {
          q: "¿Cuándo aplican las Operaciones Enterprise?",
          a: "Las Operaciones Enterprise están diseñadas para clubes, resorts, hoteles y entornos multi-sucursal complejos donde el precio estándar por ubicación no refleja el alcance operacional. Estas operaciones a menudo involucran múltiples puntos de venta de A&B, producción de banquetes y eventos, múltiples sistemas POS o requisitos de reportes personalizados.",
        },
        {
          q: "¿Hay precios para primeros adoptantes?",
          a: "Sí — ofrecemos precios fundadores para nuestras primeras 50 cuentas. Contáctanos a través de la página de Contacto para preguntar. Mantenemos las tarifas específicas fuera de la página de precios pública intencionalmente para dar a los primeros clientes una ventaja significativa.",
        },
        {
          q: "¿Puedo comenzar con una ubicación y agregar más después?",
          a: "Sí. La suscripción de la plataforma incluye tu primera operación. A medida que tu operación crece, se agregan ubicaciones adicionales a la suscripción a la tarifa por ubicación. Conéctate con nuestro equipo cuando estés listo para expandirte.",
        },
      ],
      ctaTitle: "¿Listo para ver cómo funciona en tu cocina?",
      ctaBody: "Conéctate con nuestro equipo. Revisaremos tu operación actual, responderemos tus preguntas y confirmaremos si FnB Cost Pro es la opción correcta — antes de que te comprometas con algo.",
      ctaButton: "Agendar una Revisión Culinaria",
    },
    about: {
      meta: {
        title: "Nosotros — FnB Cost Pro: La Cocina No Debería Adaptarse al Software",
        description:
          "FnB Cost Pro está construido para restaurantes liderados por chefs y operaciones profesionales de A&B. Inteligencia operacional para equipos culinarios, sin carga administrativa adicional.",
      },
      badge: "Nuestra historia",
      headline: "Ayudamos a los Restaurantes a Encontrar Oportunidades de Ahorro Más Rápido",
      subheadline:
        "FnB Cost Pro nació de una frustración simple: los operadores de restaurantes pasaban demasiado tiempo escribiendo menús, recetas, facturas y conteos de inventario en software antes de poder ver algo útil.",
      storyBody:
        "Creamos FnB Cost Pro para cambiar eso. Al reemplazar gran parte del trabajo de teclado con configuración basada en fotos, los operadores pueden llegar a la visibilidad de costos de alimentos más rápido — comenzando con un proceso guiado de 14 días diseñado para identificar al menos una oportunidad de ahorro.",
      missionTitle: "Nuestra misión",
      mission1:
        "Alimentos y Bebidas es una de las industrias más sensibles al margen del mundo. Un cambio del 1–2% en el costo de alimentos puede ser la diferencia entre un mes rentable y una pérdida. Para un restaurante con $500,000 al año, cada 1% de mejora en el costo de alimentos representa $5,000 anuales.",
      mission2:
        "Sin embargo, la mayoría de los operadores aún carecen de una forma rápida y práctica de convertir menús, recetas, facturas de proveedores y conteos de inventario en información utilizable sobre costos. Nuestra misión es ayudar a los operadores a encontrar esas oportunidades más rápido.",
      mission3:
        "El operador apunta la cámara. FnB Cost Pro extrae los datos, los estructura y ayuda al equipo a revisar, confirmar y actuar.",
      valuesLabel: "Nuestros valores",
      valuesTitle: "Lo que nos impulsa",
      values: [
        {
          title: "Creado por operadores, para operadores",
          body: "Cada función en FnB Cost Pro está diseñada en torno a flujos de trabajo reales de restaurante: conteos de inventario nocturnos, cambios de precios de proveedores, recetas escritas a mano y la presión de proteger los márgenes sin agregar trabajo administrativo.",
        },
        {
          title: "Visibilidad de costos antes que el papeleo",
          body: "Los operadores no deberían tener que pasar semanas escribiendo datos antes de poder ver dónde puede estar perdiendo costos. FnB Cost Pro usa configuración basada en fotos para llevar a los restaurantes a la información más rápido.",
        },
        {
          title: "Guiado hacia la primera oportunidad",
          body: "El software solo no arregla los costos de alimentos. FnB Cost Pro combina una configuración rápida con un proceso guiado de 14 días diseñado para identificar al menos una oportunidad de ahorro.",
        },
        {
          title: "Práctico, no perfecto",
          body: "Los datos de restaurante son complicados. Los menús cambian, las facturas varían, las recetas viven en tarjetas y portapapeles. FnB Cost Pro está construido para ayudar a los operadores a convertir datos imperfectos en decisiones útiles.",
        },
      ],
      whoLabel: "Para quién somos",
      whoTitle: "Para Operadores que Necesitan Visibilidad de Costos Sin Más Trabajo Administrativo",
      whoSubtitle:
        "Ya sea que gestiones una sucursal o muchas, FnB Cost Pro está diseñado para operaciones donde los costos de alimentos importan y el tiempo es escaso.",
      whoItems: [
        {
          title: "Restaurantes independientes",
          body: "FnB Cost Pro Starter ayuda a operadores de una sola ubicación a escanear menús, costear recetas, revisar facturas e identificar oportunidades de costos sin contratar personal administrativo.",
        },
        {
          title: "Grupos multi-sucursal",
          body: "Dos sucursales o veinte. Usa reportes a nivel de ubicación para comparar dónde los costos, el desperdicio, los precios de proveedores o la varianza de recetas pueden estar desviándose.",
        },
        {
          title: "Bares y operaciones de bebidas",
          body: "Rastrea recetas de bebidas, costos de proveedores y varianza con el mismo flujo de trabajo foto-primero. Costo de vertido por receta, seguimiento de varianza y guías de proveedores.",
        },
        {
          title: "Catering y eventos",
          body: "Costeo de recetas para producción de cantidad variable. Construye recetas de eventos, cóstalas por persona y rastrea costos de ingredientes frente a los ingresos de catering.",
        },
        {
          title: "Cocinas fantasma",
          body: "Operaciones multi-concepto bajo un mismo techo. Gestiona bibliotecas de recetas e inventario separados por concepto desde una cuenta de FnB Cost Pro.",
        },
        {
          title: "Hoteles y resorts",
          body: "Múltiples puntos de venta y menús complejos. El plan Enterprise soporta gestión multi-marca, integraciones personalizadas y soporte con SLA.",
        },
      ],
      ctaTitle: "¿Listo para Encontrar tu Primera Oportunidad de Ahorro?",
      ctaSubtitle:
        "Inicia tu Revisión de Oportunidades de Costos de 14 días. Escanea tu menú, revisa tus facturas y deja que FnB Cost Pro ayude a identificar al menos un área donde los costos de alimentos puedan estar escapándose.",
      getStartedFree: "Inicia tu Revisión de 14 Días",
      ctaSecondary: "Escanea tu menú",
    },
    contact: {
      meta: {
        title: "Contacto — FnB Cost Pro",
        description: "Ponte en contacto con el equipo de FnB Cost Pro. Preguntas sobre precios, incorporación o cómo FnB Cost Pro puede ayudar a tu operación.",
      },
      badge: "Contáctanos",
      headline: "Contacto",
      subheadline: "¿Tienes preguntas, quieres una demo o necesitas ayuda para elegir el plan correcto? Nos encantaría saber de ti.",
      contactTitle: "Contáctanos directamente",
      contactDesc: "Envíanos un mensaje y te responderemos en un día hábil.",
      emailLabel: "Correo electrónico",
      responseLabel: "Tiempo de respuesta",
      responseDesc: "Generalmente respondemos en un día hábil.",
      validationName: "El nombre debe tener al menos 2 caracteres",
      validationEmail: "Por favor ingresa una dirección de correo válida",
      validationMessage: "El mensaje debe tener al menos 10 caracteres",
      sendFailedDefault: "No se pudo enviar tu mensaje. Por favor intenta de nuevo.",
      sendFailedTitle: "Error al enviar",
      successTitle: "¡Mensaje enviado!",
      successDesc: "Gracias por contactarnos. Te responderemos pronto.",
      sendAnother: "Enviar otro mensaje",
      nameLabel: "Nombre",
      namePlaceholder: "Tu nombre",
      emailFormLabel: "Correo electrónico",
      emailPlaceholder: "tu@correo.com",
      companyLabel: "Restaurante / Empresa",
      companyPlaceholder: "Nombre de tu restaurante",
      messageLabel: "Mensaje",
      messagePlaceholder: "Cuéntanos sobre tu operación, o simplemente saluda…",
      submitting: "Enviando…",
      submitButton: "Enviar mensaje",
    },
  },
};
