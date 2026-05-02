export type Language = "en" | "es";

export const translations = {
  en: {
    nav: {
      features: "Features",
      pricing: "Pricing",
      about: "About",
      contact: "Contact",
      login: "Log in",
      getStarted: "Start Free Trial",
      myAccount: "My Account",
      goToDashboard: "Go to Dashboard",
      signOut: "Sign out",
      signingOut: "Signing out…",
    },
    footer: {
      tagline: "AI-powered inventory management and recipe costing for restaurants and Food & Beverage businesses.",
      product: "Product",
      getStarted: "Get Started",
      getStartedFree: "Start Free Trial",
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
        title: "FnB Cost Pro — AI-Powered Restaurant Food Cost Software",
        description:
          "FnB Cost Pro runs your kitchen back office from your phone. Scan menus, recipes, invoices, and shelves with AI. No keyboard required.",
      },
      badge: "AI-Powered Kitchen Management",
      headline1: "Your whole kitchen.",
      headline2: "Just your phone.",
      headline3: "",
      subheadline:
        "Point your camera at your menu, your recipe cards, your vendor invoices, your shelves — FnB Cost Pro does the rest. AI-powered setup and counting for restaurants, bars, and Food & Beverage businesses of every size.",
      ctaTrial: "Start Your 14-Day Free Trial",
      ctaPricing: "View Pricing",
      trialNote: "14-day free trial. No credit card required to start.",
      stats: [
        { value: "8 hrs", label: "Typical weekly data entry eliminated" },
        { value: "$300+", label: "Monthly labor savings for most operators" },
        { value: "3–5%", label: "Typical food cost reduction" },
        { value: "14 days", label: "Free trial — no credit card needed" },
      ],
      roiLabel: "It Pays for Itself",
      roiTitle: "Stop Paying Someone to Type. Start Using Your Phone.",
      roiSubtitle:
        "Most operators spend 6–10 hours a week on back-office data entry. FnB Cost Pro replaces nearly all of it with a photo.",
      roiItems: [
        {
          task: "Invoice entry",
          manual: "~20 min per delivery × 3 deliveries/week",
          saved: "~$80/month eliminated",
          how: "Photograph the invoice — line items extracted and matched in seconds",
        },
        {
          task: "Recipe & menu setup",
          manual: "15–30 min per recipe to type ingredients and costs",
          saved: "12–25 hours of setup labor for a 50-item menu",
          how: "Photograph your menu or recipe card — items extracted instantly",
        },
        {
          task: "Inventory counts",
          manual: "2–4 hours per count × bi-weekly",
          saved: "$80–240/month in kitchen manager time",
          how: "Walk the shelves with your phone instead of a clipboard",
        },
      ],
      roiTotal: "Conservative total: ~$300–400/month in recovered labor",
      roiNote: "Most operators recover the cost of Starter in the first week.",
      featuresLabel: "How It Works",
      featuresTitle: "Point. Shoot. Done.",
      featuresSubtitle:
        "Three workflows, all driven by your phone camera. No keyboard. No spreadsheets. No data entry.",
      seeAllFeatures: "See All Features",
      features: [
        {
          title: "Set Up by Photo",
          desc: "Photograph your printed menu and watch AI pull out every dish name, section, and price. Photograph a recipe card and get a costed recipe in seconds. Photograph a vendor invoice and have it matched to your inventory automatically.",
        },
        {
          title: "Count by Photo",
          desc: "Walk your shelves with your phone. AI reads the labels, identifies items, and logs counts directly to your inventory session — no clipboards, no re-entry, no mistakes from reading handwritten sheets.",
        },
        {
          title: "Manage & Analyze",
          desc: "Live recipe costing that recalculates the moment vendor prices change. Theoretical Food Cost variance showing exactly where your margins are going. Multi-location control from a single account.",
        },
        {
          title: "Vendor Order Guides",
          desc: "Import Sysco, GFS, and US Foods catalogs automatically. When a vendor updates pricing, every affected recipe cost updates in real time — no manual rework, ever.",
        },
        {
          title: "Multi-Location",
          desc: "Manage inventory, recipes, and team across every location from one account. Pro adds transfer orders between stores and cross-location reporting.",
        },
        {
          title: "Always Accurate Costs",
          desc: "Ingredient prices flow directly from vendor invoices into your recipes. Nested sub-recipes recalculate in the correct order. Your food cost is always current — not last month's spreadsheet.",
        },
      ],
      recipeLabel: "Recipe Costing",
      recipeTitle: "Your Food Cost — From Photo to Number in Seconds",
      recipeSubtitle:
        "Take a photo of your recipe card. FnB Cost Pro reads the ingredients, matches them to your inventory, and gives you the exact cost per portion — instantly.",
      recipeNote: "Recipe costing is included in all paid plans.",
      seePlans: "See Plans",
      recipeSteps: [
        {
          num: "1",
          title: "Photograph Your Recipe",
          body: "Point your phone at any recipe card, printed menu, or handwritten note. Our AI extracts every ingredient — quantities, units, and all.",
        },
        {
          num: "2",
          title: "Costs Calculate Automatically",
          body: "Ingredients match to your inventory and vendor pricing. Set your yield percentages and FnB Cost Pro gives you the true food cost per portion instantly.",
        },
        {
          num: "3",
          title: "Stays Current Forever",
          body: "Every recipe updates automatically when vendor prices change. Nested sub-recipes recalculate in the right order. Your costs are always accurate — not last month's guess.",
        },
      ],
      howItWorksLabel: "Setup That Actually Works",
      howItWorksTitle: "From Day One, AI Does the Heavy Lifting",
      howItWorksSubtitle:
        "Traditional restaurant software takes weeks to set up. FnB Cost Pro takes an afternoon — because your phone does the data entry.",
      steps: [
        {
          num: "01",
          title: "Scan Your Menu",
          body: "Upload a photo of your printed menu. AI extracts every dish, section, and price and seeds your recipe library in minutes — not hours.",
        },
        {
          num: "02",
          title: "Build Recipes by Camera",
          body: "Photograph recipe cards, cooking sheets, or any handwritten notes. Ingredients are extracted and costed automatically against your live vendor pricing.",
        },
        {
          num: "03",
          title: "Count and Control",
          body: "Walk your shelves with your phone. Track variances, spot waste, compare theoretical vs. actual food cost — all from the same app.",
        },
      ],
      ctaBottomTitle: "Replace Your Data Entry with a Photo",
      ctaBottomSubtitle:
        "Join F&B operators using FnB Cost Pro to eliminate manual entry, close the gap between theoretical and actual food cost, and finally run their back office from their phone.",
      ctaBottomTrial: "Start Your 14-Day Free Trial",
      ctaBottomContact: "Talk to Us",
      ctaChecklist: [
        "14-day free trial",
        "No credit card required",
        "AI setup included from day one",
        "Cancel anytime",
      ],
      stepLabel: "Step",
    },
    features: {
      meta: {
        title: "Features — FnB Cost Pro AI Restaurant Management Software",
        description:
          "Explore FnB Cost Pro's AI-powered features: scan menus, recipes, and invoices by photo, count shelves with your phone, and manage food cost across every location.",
      },
      badge: "Photo-First. AI-Powered.",
      headline: "Your Kitchen Back Office — Run From Your Phone",
      subheadline:
        "FnB Cost Pro eliminates keyboard data entry for restaurant operators. Point your camera at your menu, your recipes, your vendor invoices, your shelves. The AI does the rest.",
      badgesNote: "badges show which plan includes each feature",
      startFree: "Start Free Trial",
      upgradeTitle: "The Right Plan for Your Operation",
      upgradeSubtitle: "Start with a 14-day trial. No credit card required.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Starter — One Location",
      upgradeStarterBody:
        "Everything you need to run one location: AI menu and recipe scanning, live recipe costing, vendor order guides, inventory counts, TFC variance reporting, and the AI kitchen assistant.",
      upgradeBasicTitle: "Starter — Know Your Costs",
      upgradeBasicBody:
        "AI-powered setup, live recipe costing, vendor order guides, TFC variance reporting, and the AI kitchen assistant. Everything you need to run a tight back office at one location.",
      upgradeProTitle: "Pro — Multi-Location Control",
      upgradeProBody:
        "Everything in Starter plus AI shelf scanning, invoice auto-matching, transfer orders between stores, cross-shop vendor pricing, QuickBooks export, and unlimited locations. Built for operators running more than one store.",
      ctaTitle: "Start Your 14-Day Free Trial",
      ctaSubtitle:
        "Full access from day one. No credit card required. AI-powered setup included.",
      getStartedFree: "Start Free Trial",
      tierLabels: { free: "Free", basic: "Starter", pro: "Pro" },
      sections: [
        {
          key: "setup",
          label: "Set Up by Photo",
          badge: "All paid plans",
          headline: "Your entire back office — set up in an afternoon",
          body: "Traditional restaurant software requires weeks of manual data entry to get started. FnB Cost Pro uses AI vision to read your existing materials and build your system from photos.",
          items: [
            {
              title: "Menu Scan",
              desc: "Photograph your printed menu — AI extracts every dish, section, and price. Your recipe library is seeded in minutes, not hours. Works with printed menus, PDF screenshots, handwritten specials.",
              stat: "A 50-item menu: ~2 minutes vs. 12–25 hours manually",
            },
            {
              title: "Recipe Scan",
              desc: "Point your phone at any recipe card, index card, or printed cooking sheet. AI reads the ingredients, quantities, and units — then matches them to your inventory and calculates the food cost per portion automatically.",
              stat: "Each recipe: seconds vs. 15–30 minutes manually",
            },
            {
              title: "Invoice Scan",
              desc: "Photograph a vendor invoice and AI extracts every line item, matches it to your inventory items, and updates pricing automatically. No re-keying, no matching by hand.",
              stat: "Each delivery: ~30 seconds vs. 20 minutes manually",
            },
          ],
        },
        {
          key: "count",
          label: "Count by Photo",
          badge: "Pro plan",
          headline: "Replace the clipboard with your phone",
          body: "Physical inventory counting is one of the most time-consuming tasks in any restaurant. FnB Cost Pro's Pro tier replaces the clipboard with your phone camera.",
          items: [
            {
              title: "Shelf Scan",
              desc: "Walk your coolers, freezer, and dry storage with your phone. AI reads product labels, identifies inventory items, and logs counts directly to your active count session. No transfer to a sheet, no double-entry.",
              stat: "Saves 50–75% of count time — $80–240/month for most operators",
            },
            {
              title: "Catch-Weight Scanning",
              desc: "For proteins and items sold by weight, photograph the scale readout alongside the item and AI captures both the item identity and the exact weight in one step.",
              stat: "Eliminates the most error-prone part of a protein count",
            },
          ],
        },
        {
          key: "manage",
          label: "Manage & Analyze",
          badge: "All paid plans",
          headline: "Full cost control — always current, always accurate",
          body: "Once your data is in, FnB Cost Pro keeps everything current automatically. Vendor price changes ripple through every recipe in seconds.",
          items: [
            {
              title: "Live Recipe Costing",
              desc: "Every recipe has a live food cost per portion that recalculates the moment a vendor price changes. Nested sub-recipes recalculate in the correct dependency order. No manual updates, ever.",
            },
            {
              title: "TFC Variance Reporting",
              desc: "Theoretical Food Cost shows exactly what you should have spent based on what you sold. Compare it to what you actually spent and pinpoint waste, over-portioning, and shrinkage by category.",
            },
            {
              title: "Multi-Location Management",
              desc: "Manage inventory, recipes, par levels, and vendor access across every location from one account. Pro adds transfer orders between stores and cross-location variance reporting.",
            },
            {
              title: "Vendor & Order Guides",
              desc: "Import order guides from Sysco, GFS, US Foods, and any major distributor. Build purchase orders in seconds. Pro adds cross-shop pricing comparison to automatically surface the best price for any item.",
            },
          ],
        },
      ],
      groups: [
        {
          title: "Set Up by Photo",
          description:
            "Photograph your menu, recipe cards, and vendor invoices. AI extracts the data and builds your system automatically — no keyboard required.",
          features: [
            "Menu scan: photograph your printed menu and seed your recipe library instantly",
            "Recipe scan: photograph recipe cards and get a costed recipe in seconds",
            "Invoice scan: photograph vendor invoices and have line items auto-matched to inventory",
            "Works with printed menus, PDFs, handwritten cards, and digital screenshots",
            "AI extracts ingredients, quantities, units, and prices automatically",
          ],
        },
        {
          title: "Live Recipe Costing",
          description:
            "A built-in food cost calculator for every recipe — from simple prep items to multi-layer dishes. Always know your true cost per portion, updated automatically when vendor prices change.",
          features: [
            "Food cost calculator with ingredient-level cost breakdown",
            "Restaurant food cost per portion, calculated automatically",
            "Nested sub-recipe support for complex preparations",
            "Per-recipe yield override for different waste factors",
            "Automatic cost recalculation when ingredient prices change",
            "Mark recipes as available ingredients in other recipes",
          ],
        },
        {
          title: "Vendor & Order Guides",
          description:
            "Import your vendor catalogs in minutes. Prices auto-populate your inventory and flow directly into recipe costs — when a vendor updates pricing, every recipe recalculates.",
          features: [
            "Import order guides from Sysco, GFS, US Foods, and more",
            "Native adapters with automatic format detection",
            "Case-price entry matching real vendor invoices",
            "Automatic unit price calculation from case and inner pack",
            "Assign vendors and order guides to specific stores",
            "Prices flow into recipes — vendor price change triggers automatic recipe recalculation",
          ],
          proFeature:
            "Cross-shop vendor pricing (Pro): Compare the same item across all your vendor order guides to find the best price automatically. QuickBooks export (Pro): Export received purchase orders directly to QuickBooks.",
        },
        {
          title: "TFC Variance Reporting",
          description:
            "Stop guessing where your food cost is going. TFC variance reporting shows exactly where the gap is between what you should spend and what you actually spend.",
          features: [
            "Theoretical Food Cost calculated from sales and recipes",
            "Works with most POS systems — no POS lock-in",
            "Import sales data from the POS you already use",
            "Track average food cost per month with date-range reporting",
            "Compare theoretical vs. actual food cost by category",
            "Spot over-portioning, waste, and theft instantly",
          ],
        },
        {
          title: "Count by Photo",
          description:
            "Walk your shelves with your phone instead of a clipboard. AI reads product labels and logs counts directly to your active inventory session.",
          features: [
            "Shelf scan: AI reads labels and logs counts automatically",
            "Catch-weight scanning for proteins and by-weight items",
            "Guided count sessions by storage location",
            "Count history with user accountability tracking",
            "Variance reports comparing expected vs. counted",
            "Mobile-first design for counting on the floor",
          ],
          proFeature:
            "Shelf scan and catch-weight scanning are Pro features. All plans include manual count entry on any device.",
        },
        {
          title: "Multi-Location & Team",
          description:
            "Manage recipes, inventory, and staff across every location from one account. Transfer orders, cross-location variance, and role-based access built in.",
          features: [
            "Manage multiple stores under one company account",
            "Role-based access: admin, manager, staff",
            "Invite team members by email with store assignment",
            "Per-store inventory, par levels, and vendor access",
            "Transfer orders between locations (Pro)",
            "Waste logging with user accountability",
          ],
        },
      ],
    },
    pricing: {
      meta: {
        title: "Pricing — FnB Cost Pro Restaurant Software Plans",
        description:
          "Transparent pricing for FnB Cost Pro. Starter at $149/mo, Pro from $228/mo, Enterprise custom. 14-day free trial on all paid plans.",
      },
      badge: "Simple, Transparent Pricing",
      headline: "A Plan for Every Operation",
      subheadline:
        "All paid plans include AI setup scanning, live recipe costing, vendor order guides, and a 14-day free trial. No credit card required to start.",
      termLabels: { monthly: "Monthly", annual: "Annual" },
      savings: { monthly: null, annual: "Save ~14%" },
      mostPopular: "Most Popular",
      recommendedForYou: "Recommended for You",
      custom: "Custom",
      pricingUnavailable: "Pricing not available",
      startFreeTrial: "Start 14-Day Free Trial",
      contactSales: "Contact Sales",
      noCardRequired: "No credit card required",
      fourteenDayTrial: "14-day free trial included",
      tierNames: { free: "Free", basic: "Starter", pro: "Pro", enterprise: "Enterprise" },
      intervalLabels: { month: "month", year: "year", week: "week", day: "day" },
      tailoredNote: "For franchise groups and large multi-unit operators",
      footerNote:
        "All paid plans include a 14-day free trial. Cancel anytime. Enterprise plans are billed via invoice.",
      founderNote: "Early adopter pricing available for the first 50 accounts — reach out to learn more.",
      proOnly: "Pro",
      enterprise: "Enterprise",
      comparisonTitle: "Plan Comparison",
      comparisonSubtitle: "See exactly what's included at every level",
      faqTitle: "Frequently Asked Questions",
      faqItems: [
        {
          q: "Is there a free plan?",
          a: "There's no permanent free plan — but every paid plan comes with a 14-day free trial with full access. No credit card is required to start your trial.",
        },
        {
          q: "How fast does it pay for itself?",
          a: "Starter costs $149/month. At $18/hour, that's about 8 hours of saved data entry. Most operators spend more than that every week just on invoice keying and recipe setup. The software typically pays for itself in the first week.",
        },
        {
          q: "What's included in the free trial?",
          a: "Full access to all features in the plan you choose for 14 days. AI scanning, recipe costing, vendor order guides, everything. You won't be charged until the trial ends, and you can cancel any time before then.",
        },
        {
          q: "How does Pro per-location billing work?",
          a: "Pro is billed as a platform fee ($79/month) plus a per-store fee ($149/store/month). Your first location costs $228/month total. Annual billing lowers this to $69 + $129/store. The per-store rate scales naturally — more stores means more value from cross-location reporting and transfer orders.",
        },
        {
          q: "Do you charge setup fees?",
          a: "No mandatory setup fees. AI-assisted onboarding is included in every plan. Optional white-glove onboarding is available if you want hands-on help: $299 for Starter, $999 for Pro multi-store.",
        },
        {
          q: "What is the Enterprise plan?",
          a: "Enterprise is designed for franchise groups, multi-brand operators, and large chains. It includes custom implementation, API integrations, advanced admin controls, SLA-backed support, and dedicated onboarding. Contact our sales team for a quote.",
        },
        {
          q: "Can I switch plans later?",
          a: "Yes. You can upgrade or downgrade at any time from within the app. Changes take effect immediately.",
        },
        {
          q: "Is there early adopter pricing?",
          a: "Yes — we offer founder pricing for our first 50 accounts. Reach out via the Contact page to ask about it. We keep it off the public pricing page intentionally.",
        },
      ],
      tableHeaders: { feature: "Feature", starter: "Starter", pro: "Pro", enterprise: "Enterprise" },
      tableRows: [
        { label: "AI menu scan (setup)", starter: true, pro: true, enterprise: true },
        { label: "AI recipe scan (setup)", starter: true, pro: true, enterprise: true },
        { label: "AI invoice scan", starter: true, pro: true, enterprise: true },
        { label: "AI shelf scan (counting)", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "AI catch-weight scan", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Live recipe costing", starter: true, pro: true, enterprise: true },
        { label: "Nested sub-recipes", starter: true, pro: true, enterprise: true },
        { label: "TFC variance reporting", starter: true, pro: true, enterprise: true },
        { label: "POS sales data import", starter: true, pro: true, enterprise: "Multi-POS" },
        { label: "Vendor order guide imports", starter: true, pro: true, enterprise: true },
        { label: "Cross-shop vendor pricing", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "QuickBooks export", starter: false, pro: true, enterprise: "Add-on", proOnly: true },
        { label: "Transfer orders", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Power Inventory counting", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Store locations", starter: "1", pro: "Unlimited", enterprise: "Unlimited" },
        { label: "Team member seats", starter: "3", pro: "Unlimited", enterprise: "Unlimited" },
        { label: "AI kitchen assistant", starter: true, pro: true, enterprise: true },
        { label: "Custom Security Levels", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Multi-brand / franchise analytics", starter: false, pro: false, enterprise: true, enterpriseOnly: true },
        { label: "Support", starter: "Online chat", pro: "Priority", enterprise: "SLA + onboarding" },
      ],
      starterFeatures: [
        "1 store location · 3 team seats",
        "AI menu scan — seed your recipe library from a photo",
        "AI recipe scan — photograph recipe cards and get costed recipes",
        "AI invoice scan — photograph invoices and auto-match to inventory",
        "Live recipe costing with automatic price updates",
        "Nested sub-recipe support",
        "Vendor order guide imports (Sysco, GFS, US Foods)",
        "TFC variance reporting",
        "POS sales data import",
        "Smart dashboard",
        "AI kitchen assistant",
        "Online chat support",
      ],
      proFeatures: [
        "Unlimited store locations",
        "Everything in Starter",
        "AI shelf scan — count inventory with your phone camera",
        "AI catch-weight scanning for proteins",
        "Cross-shop vendor price comparison",
        "QuickBooks export for received orders",
        "Power Inventory counting",
        "Transfer orders between locations",
        "Custom Security Levels",
        "Unlimited team member seats",
        "Priority support",
      ],
      enterpriseFeatures: [
        "Everything in Pro",
        "Multi-brand inventory management",
        "Unlimited store locations & seats",
        "Multi-POS integration",
        "Franchise analytics",
        "Custom API integrations",
        "Advanced admin controls",
        "SLA + dedicated onboarding",
        "Custom implementation",
      ],
    },
    about: {
      meta: {
        title: "About FnB Cost Pro — AI-Powered Restaurant Cost Control",
        description:
          "FnB Cost Pro was built by F&B operators for F&B operators. We replaced the keyboard with a camera. Learn our story.",
      },
      badge: "Our Story",
      headline: "We Replaced the Keyboard with a Camera",
      subheadline:
        "FnB Cost Pro was born out of a simple frustration: restaurant back-office software required too much typing. We built the tool that fixes it.",
      missionTitle: "Our Mission",
      mission1:
        "Food & Beverage is one of the most margin-sensitive industries in the world. A 1–2% shift in food cost can be the difference between a profitable month and a loss. Yet most F&B operators are spending 6–10 hours a week on data entry just to keep their cost data current.",
      mission2:
        "We built FnB Cost Pro to change that. AI vision now handles what used to require hours of keyboard work — scanning your menu, reading your recipe cards, extracting your vendor invoices, counting your shelves. The operator points the camera. The software does the rest.",
      mission3:
        "We believe every Food & Beverage operator — from a single-location restaurant to a multi-unit F&B group — deserves access to professional-grade food cost management that doesn't require a dedicated data-entry person to run it.",
      valuesLabel: "Our Values",
      valuesTitle: "What Drives Us",
      values: [
        {
          title: "Built for Operators, by Operators",
          body: "Every feature in FnB Cost Pro was designed by people who have run kitchens. We know what it's like to count inventory at 11pm and re-key invoices at 7am. We built the tool we wished we had.",
        },
        {
          title: "AI That Actually Saves Time",
          body: "We don't use AI as a marketing word. Every AI feature in this product eliminates a real, time-consuming task: scanning menus, extracting recipe ingredients, reading vendor invoices, counting shelves. You should feel the time savings on day one.",
        },
        {
          title: "No Keyboard Required",
          body: "The best restaurant software is the one your team actually uses. We designed FnB Cost Pro to work entirely from a phone camera so there's no friction between the kitchen and the data.",
        },
      ],
      whoLabel: "Who We're Built For",
      whoTitle: "Any F&B Operator Who's Done Enough Data Entry",
      whoSubtitle:
        "If you've ever spent a morning re-keying a vendor invoice, or an evening typing recipes into a spreadsheet, FnB Cost Pro was built for you.",
      whoItems: [
        {
          title: "Independent Restaurants",
          body: "One location, owner-operated. You need food cost control without a full-time admin. FnB Cost Pro Starter gives you AI setup, live recipe costing, and TFC variance for $149/month.",
        },
        {
          title: "Multi-Unit Groups",
          body: "Two locations or twenty. FnB Cost Pro Pro gives you per-store inventory, cross-location variance, transfer orders, and AI shelf scanning — billed per location so costs scale with your operation.",
        },
        {
          title: "Bars & Beverage Operations",
          body: "Beverage cost control with the same photo-first workflow. Pour cost by recipe, variance tracking, and vendor order guides that handle spirits, beer, wine, and NA beverages.",
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
      ctaTitle: "Ready to Replace Your Clipboard?",
      ctaSubtitle:
        "Start your 14-day free trial. Point your phone at your menu. See your food costs in minutes.",
      getStartedFree: "Start Your Free Trial",
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
      getStarted: "Iniciar prueba gratis",
      myAccount: "Mi cuenta",
      goToDashboard: "Ir al panel",
      signOut: "Cerrar sesión",
      signingOut: "Cerrando sesión…",
    },
    footer: {
      tagline: "Gestión de inventario con IA y costeo de recetas para restaurantes y negocios de Alimentos y Bebidas.",
      product: "Producto",
      getStarted: "Comenzar",
      getStartedFree: "Iniciar prueba gratis",
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
        title: "FnB Cost Pro — Software de Costos para Restaurantes con IA",
        description:
          "FnB Cost Pro gestiona tu cocina desde tu teléfono. Escanea menús, recetas, facturas y estantes con IA. Sin teclado.",
      },
      badge: "Gestión de Cocina con IA",
      headline1: "Tu cocina completa.",
      headline2: "Solo tu teléfono.",
      headline3: "",
      subheadline:
        "Apunta tu cámara a tu menú, tus tarjetas de recetas, tus facturas de proveedores, tus estantes — FnB Cost Pro hace el resto. Configuración y conteo con IA para restaurantes de todo tipo.",
      ctaTrial: "Iniciar prueba gratuita de 14 días",
      ctaPricing: "Ver precios",
      trialNote: "Prueba gratuita de 14 días. Sin tarjeta de crédito para comenzar.",
      stats: [
        { value: "8 hrs", label: "Entrada de datos semanal típica eliminada" },
        { value: "$300+", label: "Ahorro mensual en mano de obra para la mayoría" },
        { value: "3–5%", label: "Reducción típica del costo de alimentos" },
        { value: "14 días", label: "Prueba gratuita — sin tarjeta de crédito" },
      ],
      roiLabel: "Se paga solo",
      roiTitle: "Deja de pagar para escribir. Empieza a usar tu teléfono.",
      roiSubtitle:
        "La mayoría de los operadores pasan 6–10 horas a la semana en entrada de datos administrativa. FnB Cost Pro reemplaza casi todo con una foto.",
      roiItems: [
        {
          task: "Entrada de facturas",
          manual: "~20 min por entrega × 3 entregas/semana",
          saved: "~$80/mes eliminados",
          how: "Fotografía la factura — líneas extraídas y emparejadas en segundos",
        },
        {
          task: "Configuración de recetas y menú",
          manual: "15–30 min por receta para escribir ingredientes y costos",
          saved: "12–25 horas de trabajo para un menú de 50 ítems",
          how: "Fotografía tu menú o tarjeta de receta — ítems extraídos al instante",
        },
        {
          task: "Conteos de inventario",
          manual: "2–4 horas por conteo × cada dos semanas",
          saved: "$80–240/mes en tiempo del gerente",
          how: "Camina por los estantes con tu teléfono en lugar de un portapapeles",
        },
      ],
      roiTotal: "Total conservador: ~$300–400/mes en mano de obra recuperada",
      roiNote: "La mayoría de los operadores recuperan el costo de Starter en la primera semana.",
      featuresLabel: "Cómo funciona",
      featuresTitle: "Apunta. Toma la foto. Listo.",
      featuresSubtitle:
        "Tres flujos de trabajo, todos impulsados por la cámara de tu teléfono. Sin teclado. Sin hojas de cálculo. Sin entrada de datos.",
      seeAllFeatures: "Ver todas las funciones",
      features: [
        {
          title: "Configura con una foto",
          desc: "Fotografía tu menú impreso y la IA extrae cada plato. Fotografía una tarjeta de receta y obtén una receta con costos en segundos. Fotografía una factura de proveedor y tenla emparejada automáticamente.",
        },
        {
          title: "Cuenta con una foto",
          desc: "Camina por tus estantes con tu teléfono. La IA lee las etiquetas, identifica los artículos y registra los conteos directamente en tu sesión de inventario — sin portapapeles, sin reingreso.",
        },
        {
          title: "Gestiona y analiza",
          desc: "Costeo de recetas en vivo que recalcula en el momento en que cambian los precios de los proveedores. Varianza del Costo Teórico de Alimentos que muestra exactamente a dónde van tus márgenes.",
        },
        {
          title: "Guías de pedidos a proveedores",
          desc: "Importa catálogos de Sysco, GFS y US Foods automáticamente. Cuando un proveedor actualiza precios, todos los costos de recetas afectados se actualizan en tiempo real.",
        },
        {
          title: "Multi-sucursal",
          desc: "Gestiona inventario, recetas y equipo en cada sucursal desde una sola cuenta. Pro agrega órdenes de transferencia entre tiendas y reportes multi-sucursal.",
        },
        {
          title: "Costos siempre precisos",
          desc: "Los precios de ingredientes fluyen directamente desde las facturas de proveedores a tus recetas. Las sub-recetas anidadas se recalculan en el orden correcto. Tu costo de alimentos siempre está actualizado.",
        },
      ],
      recipeLabel: "Costeo de recetas",
      recipeTitle: "Tu costo de alimentos — de foto a número en segundos",
      recipeSubtitle:
        "Toma una foto de tu tarjeta de receta. FnB Cost Pro lee los ingredientes, los empareja con tu inventario y te da el costo exacto por porción al instante.",
      recipeNote: "El costeo de recetas está incluido en todos los planes de pago.",
      seePlans: "Ver planes",
      recipeSteps: [
        {
          num: "1",
          title: "Fotografía tu receta",
          body: "Apunta tu teléfono a cualquier tarjeta de receta o nota impresa. Nuestra IA extrae cada ingrediente — cantidades, unidades y todo.",
        },
        {
          num: "2",
          title: "Los costos se calculan automáticamente",
          body: "Los ingredientes se emparejan con tu inventario y precios de proveedores. Establece tus porcentajes de merma y FnB Cost Pro calcula el costo real por porción al instante.",
        },
        {
          num: "3",
          title: "Se mantiene actualizado para siempre",
          body: "Cada receta se actualiza automáticamente cuando cambian los precios de los proveedores. Las sub-recetas anidadas se recalculan en el orden correcto.",
        },
      ],
      howItWorksLabel: "Configuración que realmente funciona",
      howItWorksTitle: "Desde el primer día, la IA hace el trabajo pesado",
      howItWorksSubtitle:
        "El software tradicional tarda semanas en configurarse. FnB Cost Pro tarda una tarde — porque tu teléfono hace la entrada de datos.",
      steps: [
        {
          num: "01",
          title: "Escanea tu menú",
          body: "Sube una foto de tu menú impreso. La IA extrae cada plato, sección y precio y llena tu biblioteca de recetas en minutos.",
        },
        {
          num: "02",
          title: "Construye recetas con la cámara",
          body: "Fotografía tarjetas de recetas o notas escritas. Los ingredientes se extraen y costean automáticamente contra tus precios de proveedores en vivo.",
        },
        {
          num: "03",
          title: "Cuenta y controla",
          body: "Camina por tus estantes con tu teléfono. Rastrea varianzas, detecta desperdicios y compara el costo teórico vs. real — todo desde la misma app.",
        },
      ],
      ctaBottomTitle: "Reemplaza tu entrada de datos con una foto",
      ctaBottomSubtitle:
        "Únete a los operadores de A&B que usan FnB Cost Pro para eliminar la entrada manual y finalmente gestionar su cocina desde su teléfono.",
      ctaBottomTrial: "Iniciar prueba gratuita de 14 días",
      ctaBottomContact: "Contáctanos",
      ctaChecklist: [
        "Prueba gratuita de 14 días",
        "Sin tarjeta de crédito",
        "Configuración con IA incluida",
        "Cancela en cualquier momento",
      ],
      stepLabel: "Paso",
    },
    features: {
      meta: {
        title: "Funciones — FnB Cost Pro Software de Gestión con IA para Restaurantes",
        description:
          "Escanea menús, recetas y facturas por foto, cuenta estantes con tu teléfono y gestiona el costo de alimentos en cada sucursal.",
      },
      badge: "Primero la foto. Impulsado por IA.",
      headline: "Tu cocina trasera — gestionada desde tu teléfono",
      subheadline:
        "FnB Cost Pro elimina la entrada de datos por teclado. Apunta tu cámara a tu menú, recetas, facturas, estantes. La IA hace el resto.",
      badgesNote: "las insignias indican qué plan incluye cada función",
      startFree: "Iniciar prueba gratis",
      upgradeTitle: "El plan correcto para tu operación",
      upgradeSubtitle: "Comienza con una prueba de 14 días. Sin tarjeta de crédito.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Starter — Una sucursal",
      upgradeStarterBody:
        "Todo lo que necesitas para una sucursal: escaneo de menú y recetas con IA, costeo de recetas en vivo, guías de proveedores, conteos de inventario y reportes de varianza TFC.",
      upgradeBasicTitle: "Starter — Conoce tus costos",
      upgradeBasicBody:
        "Configuración con IA, costeo de recetas en vivo, guías de proveedores, reportes de varianza TFC y el asistente de cocina con IA.",
      upgradeProTitle: "Pro — Control multi-sucursal",
      upgradeProBody:
        "Todo lo de Starter más escaneo de estantes con IA, órdenes de transferencia, comparación de precios entre proveedores, exportación a QuickBooks y sucursales ilimitadas.",
      ctaTitle: "Inicia tu prueba gratuita de 14 días",
      ctaSubtitle:
        "Acceso completo desde el primer día. Sin tarjeta de crédito. Configuración con IA incluida.",
      getStartedFree: "Iniciar prueba gratis",
      tierLabels: { free: "Gratis", basic: "Starter", pro: "Pro" },
      sections: [],
      groups: [
        {
          title: "Configura con una foto",
          description:
            "Fotografía tu menú, tarjetas de recetas y facturas de proveedores. La IA extrae los datos y construye tu sistema automáticamente.",
          features: [
            "Escaneo de menú: fotografía tu menú impreso y llena tu biblioteca al instante",
            "Escaneo de recetas: fotografía tarjetas de recetas y obtén recetas costeadas en segundos",
            "Escaneo de facturas: fotografía facturas y auto-emparejar con inventario",
            "Funciona con menús impresos, PDFs, tarjetas escritas a mano y capturas digitales",
            "La IA extrae ingredientes, cantidades, unidades y precios automáticamente",
          ],
        },
        {
          title: "Costeo de recetas en vivo",
          description:
            "Una calculadora de costo integrada para cada receta. Siempre conoce el verdadero costo por porción, actualizado automáticamente cuando cambian los precios.",
          features: [
            "Calculadora de costos con desglose por ingrediente",
            "Costo por porción calculado automáticamente",
            "Soporte de sub-recetas anidadas",
            "Ajuste de merma por receta",
            "Recálculo automático cuando cambian los precios",
            "Marca recetas como ingredientes en otras recetas",
          ],
        },
        {
          title: "Proveedores y guías de pedidos",
          description:
            "Importa tus catálogos en minutos. Los precios fluyen directamente a los costos de recetas.",
          features: [
            "Importa guías de Sysco, GFS, US Foods y más",
            "Adaptadores nativos con detección automática de formato",
            "Ingreso de precios por caja que coincide con facturas reales",
            "Cálculo automático del precio unitario",
            "Asigna proveedores a tiendas específicas",
            "Los precios fluyen a las recetas — cambio de precio activa recálculo automático",
          ],
          proFeature:
            "Comparación de precios entre proveedores (Pro): Encuentra el mejor precio automáticamente. Exportación a QuickBooks (Pro).",
        },
        {
          title: "Varianza TFC",
          description:
            "Deja de adivinar a dónde va tu costo de alimentos. Los reportes de varianza TFC muestran exactamente dónde está la brecha.",
          features: [
            "Costo Teórico de Alimentos calculado desde ventas y recetas",
            "Funciona con la mayoría de sistemas POS",
            "Importa datos de ventas del POS que ya usas",
            "Rastrea el costo promedio mensual con informes por fecha",
            "Compara el costo teórico vs. real por categoría",
            "Detecta sobre-porciones, desperdicios y robos al instante",
          ],
        },
        {
          title: "Cuenta con una foto",
          description:
            "Camina por tus estantes con tu teléfono en lugar de un portapapeles. La IA lee las etiquetas y registra los conteos automáticamente.",
          features: [
            "Escaneo de estantes: la IA lee etiquetas y registra conteos",
            "Escaneo de peso-captura para proteínas",
            "Sesiones de conteo guiadas por ubicación",
            "Historial de conteos con responsabilidad por usuario",
            "Informes de varianza esperado vs. contado",
            "Diseño móvil para conteos en la planta",
          ],
          proFeature:
            "El escaneo de estantes y peso-captura son funciones Pro. Todos los planes incluyen entrada manual de conteos.",
        },
        {
          title: "Multi-sucursal y equipo",
          description:
            "Gestiona recetas, inventario y personal en cada sucursal desde una sola cuenta.",
          features: [
            "Administra múltiples tiendas bajo una cuenta",
            "Acceso basado en roles: administrador, gerente, personal",
            "Invita miembros por correo con asignación de tienda",
            "Inventario y proveedores por tienda",
            "Órdenes de transferencia entre sucursales (Pro)",
            "Registro de desperdicios con responsabilidad de usuario",
          ],
        },
      ],
    },
    pricing: {
      meta: {
        title: "Precios — Planes de FnB Cost Pro para Restaurantes",
        description:
          "Precios transparentes. Starter $149/mes, Pro desde $228/mes, Enterprise personalizado. Prueba gratuita de 14 días en todos los planes.",
      },
      badge: "Precios simples y transparentes",
      headline: "Un plan para cada operación",
      subheadline:
        "Todos los planes de pago incluyen escaneo con IA, costeo de recetas en vivo, guías de proveedores y prueba gratuita de 14 días.",
      termLabels: { monthly: "Mensual", annual: "Anual" },
      savings: { monthly: null, annual: "Ahorra ~14%" },
      mostPopular: "Más popular",
      recommendedForYou: "Recomendado para ti",
      custom: "Personalizado",
      pricingUnavailable: "Precio no disponible",
      startFreeTrial: "Iniciar prueba de 14 días",
      contactSales: "Contactar ventas",
      noCardRequired: "Sin tarjeta de crédito",
      fourteenDayTrial: "Prueba gratuita de 14 días",
      tierNames: { free: "Gratis", basic: "Starter", pro: "Pro", enterprise: "Enterprise" },
      intervalLabels: { month: "mes", year: "año", week: "semana", day: "día" },
      tailoredNote: "Para grupos de franquicia y grandes operadores multi-sucursal",
      footerNote:
        "Todos los planes de pago incluyen prueba gratuita de 14 días. Cancela cuando quieras. Los planes Enterprise se facturan mediante factura.",
      founderNote: "Precios para primeros adoptantes disponibles para las primeras 50 cuentas — contáctanos para más información.",
      proOnly: "Pro",
      enterprise: "Enterprise",
      comparisonTitle: "Comparación de planes",
      comparisonSubtitle: "Ve exactamente qué está incluido en cada nivel",
      faqTitle: "Preguntas frecuentes",
      faqItems: [
        {
          q: "¿Hay un plan gratuito?",
          a: "No hay un plan gratuito permanente, pero cada plan de pago incluye una prueba gratuita de 14 días con acceso completo. No se requiere tarjeta de crédito para comenzar.",
        },
        {
          q: "¿Qué tan rápido se paga solo?",
          a: "Starter cuesta $149/mes. A $18/hora, eso son unas 8 horas de entrada de datos ahorradas. La mayoría de los operadores pasan más que eso solo en facturas y configuración de recetas. El software generalmente se paga en la primera semana.",
        },
        {
          q: "¿Qué incluye la prueba gratuita?",
          a: "Acceso completo a todas las funciones del plan que elijas durante 14 días. No se te cobrará hasta que termine la prueba.",
        },
        {
          q: "¿Cómo funciona la facturación por sucursal en Pro?",
          a: "Pro se factura como una tarifa de plataforma ($79/mes) más una tarifa por tienda ($149/tienda/mes). La primera ubicación cuesta $228/mes en total. La facturación anual reduce esto a $69 + $129/tienda.",
        },
        {
          q: "¿Cobran cargos de configuración?",
          a: "Sin cargos de configuración obligatorios. La incorporación asistida por IA está incluida en todos los planes. La incorporación personalizada es opcional: $299 para Starter, $999 para Pro multi-sucursal.",
        },
        {
          q: "¿Qué es el plan Enterprise?",
          a: "Enterprise está diseñado para grupos de franquicias y grandes operadores. Incluye implementación personalizada, integraciones API, soporte con SLA e incorporación dedicada.",
        },
        {
          q: "¿Puedo cambiar de plan más adelante?",
          a: "Sí. Puedes actualizar o reducir tu plan en cualquier momento desde la app.",
        },
        {
          q: "¿Hay precios para primeros adoptantes?",
          a: "Sí — ofrecemos precios fundadores para nuestras primeras 50 cuentas. Contáctanos para preguntar.",
        },
      ],
      tableHeaders: { feature: "Función", starter: "Starter", pro: "Pro", enterprise: "Enterprise" },
      tableRows: [
        { label: "Escaneo de menú con IA", starter: true, pro: true, enterprise: true },
        { label: "Escaneo de recetas con IA", starter: true, pro: true, enterprise: true },
        { label: "Escaneo de facturas con IA", starter: true, pro: true, enterprise: true },
        { label: "Escaneo de estantes con IA", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Escaneo de peso-captura con IA", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Costeo de recetas en vivo", starter: true, pro: true, enterprise: true },
        { label: "Sub-recetas anidadas", starter: true, pro: true, enterprise: true },
        { label: "Reportes de varianza TFC", starter: true, pro: true, enterprise: true },
        { label: "Importación de ventas POS", starter: true, pro: true, enterprise: "Multi-POS" },
        { label: "Guías de pedidos de proveedores", starter: true, pro: true, enterprise: true },
        { label: "Comparación de precios entre proveedores", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Exportación a QuickBooks", starter: false, pro: true, enterprise: "Add-on", proOnly: true },
        { label: "Órdenes de transferencia", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Conteo de inventario clave", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Ubicaciones de tienda", starter: "1", pro: "Ilimitadas", enterprise: "Ilimitadas" },
        { label: "Puestos de equipo", starter: "3", pro: "Ilimitados", enterprise: "Ilimitados" },
        { label: "Asistente de cocina con IA", starter: true, pro: true, enterprise: true },
        { label: "Niveles de seguridad personalizados", starter: false, pro: true, enterprise: true, proOnly: true },
        { label: "Multi-marca / análisis de franquicia", starter: false, pro: false, enterprise: true, enterpriseOnly: true },
        { label: "Soporte", starter: "Chat en línea", pro: "Prioritario", enterprise: "SLA + incorporación" },
      ],
      starterFeatures: [
        "1 tienda · 3 puestos de equipo",
        "Escaneo de menú con IA",
        "Escaneo de recetas con IA",
        "Escaneo de facturas con IA",
        "Costeo de recetas en vivo",
        "Sub-recetas anidadas",
        "Guías de proveedores (Sysco, GFS, US Foods)",
        "Reportes de varianza TFC",
        "Importación de ventas POS",
        "Panel inteligente",
        "Asistente de cocina con IA",
        "Soporte por chat",
      ],
      proFeatures: [
        "Sucursales ilimitadas",
        "Todo lo de Starter",
        "Escaneo de estantes con IA",
        "Escaneo de peso-captura con IA",
        "Comparación de precios entre proveedores",
        "Exportación a QuickBooks",
        "Conteo de inventario clave",
        "Órdenes de transferencia",
        "Niveles de seguridad personalizados",
        "Puestos de equipo ilimitados",
        "Soporte prioritario",
      ],
      enterpriseFeatures: [
        "Todo lo de Pro",
        "Gestión multi-marca",
        "Sucursales y puestos ilimitados",
        "Integración multi-POS",
        "Análisis de franquicia",
        "Integraciones API personalizadas",
        "Controles de administración avanzados",
        "SLA + incorporación dedicada",
        "Implementación personalizada",
      ],
    },
    about: {
      meta: {
        title: "Nosotros — FnB Cost Pro Control de Costos para Restaurantes con IA",
        description:
          "FnB Cost Pro fue creado por operadores de A&B para operadores de A&B. Reemplazamos el teclado con una cámara.",
      },
      badge: "Nuestra historia",
      headline: "Reemplazamos el teclado con una cámara",
      subheadline:
        "FnB Cost Pro nació de una frustración simple: el software de back office de restaurantes requería demasiado escribir. Creamos la herramienta que lo resuelve.",
      missionTitle: "Nuestra misión",
      mission1:
        "Alimentos y Bebidas es una de las industrias más sensibles al margen del mundo. Un cambio del 1–2% en el costo de alimentos puede ser la diferencia entre un mes rentable y una pérdida. Sin embargo, la mayoría de los operadores pasan 6–10 horas a la semana en entrada de datos solo para mantener sus costos actualizados.",
      mission2:
        "Creamos FnB Cost Pro para cambiar eso. La visión con IA ahora maneja lo que antes requería horas de trabajo de teclado — escanear tu menú, leer tus tarjetas de recetas, extraer tus facturas de proveedores, contar tus estantes. El operador apunta la cámara. El software hace el resto.",
      mission3:
        "Creemos que todo operador de A&B — desde un restaurante de una sola sucursal hasta un grupo multi-sucursal — merece acceso a una gestión profesional de costos de alimentos que no requiere una persona dedicada a la entrada de datos.",
      valuesLabel: "Nuestros valores",
      valuesTitle: "Lo que nos impulsa",
      values: [
        {
          title: "Creado por operadores, para operadores",
          body: "Cada función en FnB Cost Pro fue diseñada por personas que han gestionado cocinas. Sabemos lo que es contar inventario a las 11pm y reingresar facturas a las 7am. Creamos la herramienta que deseábamos tener.",
        },
        {
          title: "IA que realmente ahorra tiempo",
          body: "No usamos IA como palabra de marketing. Cada función de IA en este producto elimina una tarea real y que consume tiempo: escanear menús, extraer ingredientes, leer facturas, contar estantes. Deberías sentir el ahorro de tiempo desde el día uno.",
        },
        {
          title: "Sin teclado requerido",
          body: "El mejor software de restaurante es el que tu equipo realmente usa. Diseñamos FnB Cost Pro para funcionar completamente desde la cámara de un teléfono para que no haya fricción entre la cocina y los datos.",
        },
      ],
      whoLabel: "Para quién somos",
      whoTitle: "Cualquier operador de A&B que ya ha hecho suficiente entrada de datos",
      whoSubtitle:
        "Si alguna vez has pasado una mañana reingresando una factura de proveedor, FnB Cost Pro fue creado para ti.",
      whoItems: [
        {
          title: "Restaurantes independientes",
          body: "Una ubicación, operado por el propietario. Necesitas control de costos sin un administrador de tiempo completo. FnB Cost Pro Starter te da configuración con IA y costeo en vivo por $149/mes.",
        },
        {
          title: "Grupos multi-sucursal",
          body: "Dos sucursales o veinte. FnB Cost Pro Pro te da inventario por tienda, varianza multi-sucursal, órdenes de transferencia y escaneo de estantes con IA.",
        },
        {
          title: "Bares y operaciones de bebidas",
          body: "Control de costos de bebidas con el mismo flujo de trabajo. Costo por receta, seguimiento de varianza y guías de proveedores para licores, cerveza, vino y bebidas.",
        },
        {
          title: "Catering y eventos",
          body: "Costeo de recetas para producción de cantidad variable. Construye recetas de eventos, cóstalas por persona y rastrea costos de ingredientes.",
        },
        {
          title: "Cocinas fantasma",
          body: "Operaciones multi-concepto bajo un mismo techo. Gestiona bibliotecas de recetas e inventario separados por concepto desde una cuenta.",
        },
        {
          title: "Hoteles y resorts",
          body: "Múltiples puntos de venta y menús complejos. El plan Enterprise soporta gestión multi-marca, integraciones personalizadas y soporte con SLA.",
        },
      ],
      ctaTitle: "¿Listo para reemplazar tu portapapeles?",
      ctaSubtitle:
        "Inicia tu prueba gratuita de 14 días. Apunta tu teléfono a tu menú. Ve tus costos de alimentos en minutos.",
      getStartedFree: "Iniciar tu prueba gratis",
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
