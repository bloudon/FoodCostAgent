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
      badge: "14-Day Food Cost Opportunity Guarantee",
      headline1: "Find Your First Food Cost",
      headline2: "Savings Opportunity in 14 Days",
      headline3: "",
      subheadline:
        "FnB Cost Pro helps restaurants turn menus, recipes, invoices, vendor pricing, and inventory data into clear food cost insight — starting with a guided launch designed to uncover at least one savings opportunity.",
      ctaTrial: "Start Your 14-Day Opportunity Review",
      ctaPricing: "View Pricing",
      trialNote: "Guided Launch in an afternoon. 14-Day Food Cost Opportunity Guarantee. Cancel anytime.",
      stats: [
        { value: "8 hrs", label: "Weekly back-office data entry eliminated" },
        { value: "$5,000", label: "Value of 1% food cost improvement at $500k/year" },
        { value: "14 days", label: "To your first food cost savings opportunity" },
        { value: "1 day", label: "Guided Launch — operational in an afternoon" },
      ],
      roiMathLabel: "The Math Is Simple",
      roiMathTitle: "Small Percentage Changes Create Big Dollars",
      roiMathSubtitle:
        "Most restaurants don't need a massive improvement to justify better food cost visibility. Finding even 0.5% in food cost opportunity can cover the first year.",
      roiMathHeaders: {
        sales: "Annual Sales",
        half: "0.5% Opportunity",
        one: "1% Opportunity",
        two: "2% Opportunity",
      },
      roiMathRows: [
        { sales: "$500,000", half: "$2,500", one: "$5,000", two: "$10,000" },
        { sales: "$750,000", half: "$3,750", one: "$7,500", two: "$15,000" },
        { sales: "$1,000,000", half: "$5,000", one: "$10,000", two: "$20,000" },
      ],
      roiMathNote: "We identify the opportunity. Actual savings depend on the actions you take.",
      menuScanLabel: "Menu Scan",
      menuScanTitle: "Start With Your Menu. See Food Cost Clues in Minutes.",
      menuScanSubtitle:
        "Upload a photo of your menu and FnB Cost Pro begins organizing your items, departments, prices, and ingredient clues. Instead of starting from a blank spreadsheet, your menu becomes the starting map for recipe costing, invoice review, and food cost opportunity discovery.",
      menuScanCallouts: [
        "Menu items extracted",
        "Departments organized",
        "Prices captured",
        "Ingredient clues identified",
        "Recipe build-out starting point",
        "Margin review starting point",
      ],
      roiLabel: "It Pays for Itself When You Find the Leak",
      roiTitle: "Stop Guessing Where Food Cost Is Leaking.",
      roiSubtitle:
        "Labor savings matter. But the bigger prize is food cost visibility — knowing exactly where money is leaving before it becomes a problem.",
      roiItems: [
        {
          task: "Invoice entry → vendor price tracking",
          manual: "~20 min per delivery × 3 deliveries/week",
          saved: "~$80/month in entry time eliminated",
          how: "Photograph the invoice — line items extracted and matched, and every price change flows into your recipe costs instantly",
        },
        {
          task: "Recipe & menu setup → true plate cost",
          manual: "15–30 min per recipe to type ingredients and costs",
          saved: "12–25 hours of setup labor for a 50-item menu",
          how: "Photograph your menu or recipe card — items extracted instantly, plate costs calculated against live vendor pricing",
        },
        {
          task: "Inventory counts → actual vs. theoretical",
          manual: "2–4 hours per count × bi-weekly",
          saved: "$80–240/month in kitchen manager time",
          how: "Walk the shelves with your phone — counts feed directly into variance reporting so you can see where food cost is drifting",
        },
      ],
      roiTotal: "For many restaurants, finding less than 1% in food cost opportunity can cover the first year.",
      roiNote: "Labor savings are real too — most operators eliminate 6–10 hours of weekly data entry.",
      featuresLabel: "The Proof Mechanism",
      featuresTitle: "Scan. Structure. Find the Opportunity.",
      featuresSubtitle:
        "Every workflow is driven by your phone camera — each one feeding clearer food cost insight.",
      seeAllFeatures: "See All Features",
      features: [
        {
          title: "Menu Scan → Food Cost Starting Map",
          desc: "Photograph your printed menu and every dish name, section, and price is extracted automatically. Your menu becomes the foundation for recipe costing, invoice review, and identifying where food cost opportunities may exist.",
        },
        {
          title: "Count by Phone → Actual vs. Theoretical",
          desc: "Walk your shelves with your phone. Counts feed directly into variance reporting — so you can see the gap between what you should have spent and what you actually spent.",
        },
        {
          title: "Variance Reporting → Find the Leak",
          desc: "Theoretical Food Cost variance shows exactly where margins are going. Compare expected spend to actual spend and pinpoint waste, over-portioning, and shrinkage by category.",
        },
        {
          title: "Invoice Scan → Vendor Price Tracking",
          desc: "Photograph a vendor delivery and every price change is captured automatically. Price increases flow instantly into recipe costs — so you always know when a dish's food cost has drifted.",
        },
        {
          title: "Multi-Location",
          desc: "Manage inventory, recipes, and team across every location from one account. Pro adds transfer orders between stores and cross-location reporting.",
        },
        {
          title: "Live Recipe Costing",
          desc: "Ingredient prices flow directly from vendor invoices into your recipes. Nested sub-recipes recalculate in the correct order. Your food cost is always current — not last month's spreadsheet.",
        },
      ],
      recipeLabel: "Recipe Costing",
      recipeTitle: "True Plate Cost — From Photo to Number",
      recipeSubtitle:
        "Food cost estimates begin immediately once ingredients are matched to inventory and vendor pricing. Photograph a recipe card and see where plate cost stands — and whether it has drifted since the last vendor delivery.",
      recipeNote: "Recipe costing is included in all paid plans.",
      seePlans: "See Plans",
      recipeSteps: [
        {
          num: "1",
          title: "Photograph Your Recipe",
          body: "Point your phone at any recipe card, printed menu, or handwritten note. Every ingredient is read from the photo — quantities, units, and all.",
        },
        {
          num: "2",
          title: "Food Cost Begins to Emerge",
          body: "Ingredients match to your inventory and vendor pricing. Set your yield percentages and FnB Cost Pro gives you the true food cost per portion — and flags ingredients where price has changed since your last count.",
        },
        {
          num: "3",
          title: "Catches Every Vendor Price Change",
          body: "Every recipe updates automatically when vendor prices change. Nested sub-recipes recalculate in the right order. You always know your current plate cost — not last month's guess.",
        },
      ],
      howItWorksLabel: "The Guided Launch Journey",
      howItWorksTitle: "Start With Your Menu. Reach Food Cost Insight in 14 Days.",
      howItWorksSubtitle:
        "FnB Cost Pro is designed to get your first location operational in an afternoon with a guided launch — and to begin identifying food cost opportunities within 14 days.",
      steps: [
        {
          num: "01",
          title: "Scan Your Menu",
          body: "Upload a photo of your printed menu. Every dish, section, and price is extracted and seeds your recipe library in minutes — giving you the starting map for food cost review.",
        },
        {
          num: "02",
          title: "Review Invoices and Vendor Pricing",
          body: "Photograph your vendor invoices or import your order guides. Every price lands in your recipe costs automatically — so you can see where ingredient cost is moving.",
        },
        {
          num: "03",
          title: "Identify Your First Savings Opportunity",
          body: "Within 14 days, your Guided Launch Session reviews your menu, recipes, invoices, and variance data to identify at least one area where food cost may be leaking.",
        },
      ],
      ctaBottomTitle: "Ready to Find Your First Food Cost Opportunity?",
      ctaBottomSubtitle:
        "Give us 14 days. We'll help identify at least one area where food cost may be leaking — using your menu, recipes, invoices, vendor pricing, or inventory process.",
      ctaBottomTrial: "Start Your 14-Day Opportunity Review",
      ctaBottomContact: "Talk to Us",
      ctaChecklist: [
        "14-Day Food Cost Opportunity Guarantee",
        "Cancel anytime",
        "Guided Launch in an afternoon",
        "Identify at least one savings opportunity",
      ],
      stepLabel: "Step",
      mobileShowcaseTitle: "Every workflow feeds food cost insight",
      mobileShowcaseSubtitle:
        "Count inventory, scan invoices, cost recipes — each one closing the loop between what you spend and what you should spend. No app store needed.",
      mobilePhoneLabels: [
        "Actual vs. theoretical — find the variance",
        "Catch vendor price changes automatically",
        "True plate cost — always current",
      ],
      mobileCallouts: [
        { label: "Food cost visibility", sub: "Every scan feeds clearer cost insight" },
        { label: "Always current", sub: "Vendor price changes update recipes instantly" },
        { label: "Actual vs. theoretical", sub: "Counts feed directly into variance reports" },
      ],
      menuScanCTA: "Scan Your Menu",
      menuScanMockTitle: "Menu scan complete",
      menuScanMockSub: "Brian's Bistro — 3 sections, 42 items",
      menuScanMockSections: [
        { section: "Appetizers", count: "8 items", avg: "avg $12.50" },
        { section: "Entrees", count: "18 items", avg: "avg $24.00" },
        { section: "Desserts", count: "6 items", avg: "avg $9.75" },
        { section: "Beverages", count: "10 items", avg: "avg $6.50" },
      ],
      menuScanMockFooter: "42 items ready for recipe build-out",
      menuScanMockStatus: "Starting map created",
    },
    features: {
      meta: {
        title: "Platform Features — FnB Cost Pro Culinary Operations Platform",
        description:
          "Explore FnB Cost Pro's culinary operations capabilities: menu scan, recipe costing, invoice capture, inventory counting, vendor connectivity, and cross-location management.",
      },
      badge: "Features",
      headline: "Food Cost Visibility Starts With a Photo",
      subheadline:
        "FnB Cost Pro turns your existing menus, recipe cards, vendor invoices, and inventory counts into a working food cost system — faster than manual entry, with a guided 14-day process designed to find at least one savings opportunity.",
      badgesNote: "badges show which plan includes each feature",
      startFree: "Start Your 14-Day Opportunity Review",
      heroSecondaryCtaLabel: "See the Menu Scan",
      heroProofLine: "14-Day Food Cost Opportunity Guarantee. Cancel anytime.",
      upgradeTitle: "The Right Plan for Your Operation",
      upgradeSubtitle: "Start with a 14-day trial. Cancel anytime.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Starter — One Location",
      upgradeStarterBody:
        "Everything you need to run one location: menu and recipe scanning by photo, live recipe costing, vendor order guides, inventory counts, Theoretical Food Cost variance reporting, and the kitchen assistant.",
      upgradeBasicTitle: "Starter — Know Your Costs",
      upgradeBasicBody:
        "Photo-based setup, live recipe costing, vendor order guides, Theoretical Food Cost variance reporting, and the kitchen assistant. Everything you need to run a tight back of house at one location.",
      upgradeProTitle: "Pro — Multi-Location Control",
      upgradeProBody:
        "Everything in Starter plus shelf scanning by phone, invoice auto-matching, transfer orders between stores, cross-shop vendor pricing, and QuickBooks export. Add unlimited locations at $149/location/month. Built for operators running more than one store.",
      ctaTitle: "Ready to Find Your First Food Cost Opportunity?",
      ctaSubtitle:
        "Give us 14 days. We'll help you build a working food cost system and identify at least one area where food cost may be leaking.",
      getStartedFree: "Start Your 14-Day Opportunity Review",
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
      badge: "Garantía de Oportunidad en Costos de 14 Días",
      headline1: "Encuentra tu Primera Oportunidad de",
      headline2: "Ahorro en Costos en 14 Días",
      headline3: "",
      subheadline:
        "FnB Cost Pro ayuda a los restaurantes a convertir menús, recetas, facturas, precios de proveedores e inventario en información clara sobre costos de alimentos — comenzando con un lanzamiento guiado diseñado para descubrir al menos una oportunidad de ahorro.",
      ctaTrial: "Inicia tu Revisión de 14 Días",
      ctaPricing: "Ver precios",
      trialNote: "Lanzamiento guiado en una tarde. Garantía de oportunidad en costos de 14 días. Cancela cuando quieras.",
      stats: [
        { value: "8 hrs", label: "Entrada de datos administrativa semanal eliminada" },
        { value: "$5,000", label: "Valor de 1% de mejora en costos con $500k/año en ventas" },
        { value: "14 días", label: "Para tu primera oportunidad de ahorro en costos" },
        { value: "1 día", label: "Lanzamiento guiado — operativo en una tarde" },
      ],
      roiMathLabel: "Las Matemáticas Son Simples",
      roiMathTitle: "Pequeños Cambios Porcentuales Crean Grandes Diferencias",
      roiMathSubtitle:
        "La mayoría de los restaurantes no necesitan una mejora masiva para justificar una mejor visibilidad de costos. Encontrar incluso un 0.5% en oportunidad de costos puede cubrir el primer año.",
      roiMathHeaders: {
        sales: "Ventas Anuales",
        half: "0.5% de Oportunidad",
        one: "1% de Oportunidad",
        two: "2% de Oportunidad",
      },
      roiMathRows: [
        { sales: "$500,000", half: "$2,500", one: "$5,000", two: "$10,000" },
        { sales: "$750,000", half: "$3,750", one: "$7,500", two: "$15,000" },
        { sales: "$1,000,000", half: "$5,000", one: "$10,000", two: "$20,000" },
      ],
      roiMathNote: "Identificamos la oportunidad. Los ahorros reales dependen de las acciones que tomes.",
      menuScanLabel: "Escaneo de Menú",
      menuScanTitle: "Comienza con tu Menú. Ve las Claves de Costos en Minutos.",
      menuScanSubtitle:
        "Sube una foto de tu menú y FnB Cost Pro comienza a organizar tus platos, departamentos, precios y pistas de ingredientes. En lugar de comenzar desde una hoja en blanco, tu menú se convierte en el mapa inicial para el costeo de recetas, la revisión de facturas y el descubrimiento de oportunidades de costos.",
      menuScanCallouts: [
        "Platos extraídos",
        "Departamentos organizados",
        "Precios capturados",
        "Pistas de ingredientes identificadas",
        "Punto de partida para costeo de recetas",
        "Punto de partida para revisión de márgenes",
      ],
      roiLabel: "Se Paga Solo Cuando Encuentras la Fuga",
      roiTitle: "Deja de Adivinar Dónde Se Están Perdiendo los Costos.",
      roiSubtitle:
        "El ahorro en mano de obra importa. Pero el mayor beneficio es la visibilidad de costos de alimentos — saber exactamente dónde está saliendo el dinero antes de que se convierta en un problema.",
      roiItems: [
        {
          task: "Entrada de facturas → seguimiento de precios",
          manual: "~20 min por entrega × 3 entregas/semana",
          saved: "~$80/mes en tiempo de entrada eliminado",
          how: "Fotografía la factura — líneas extraídas y emparejadas, y cada cambio de precio fluye a tus costos de recetas al instante",
        },
        {
          task: "Configuración de recetas → costo real por plato",
          manual: "15–30 min por receta para escribir ingredientes",
          saved: "12–25 horas de trabajo para un menú de 50 ítems",
          how: "Fotografía tu menú o tarjeta de receta — ítems extraídos, costos calculados contra precios de proveedores en vivo",
        },
        {
          task: "Conteos de inventario → real vs. teórico",
          manual: "2–4 horas por conteo × cada dos semanas",
          saved: "$80–240/mes en tiempo de gerente",
          how: "Camina por los estantes con tu teléfono — los conteos alimentan directamente los reportes de varianza",
        },
      ],
      roiTotal: "Para muchos restaurantes, encontrar menos del 1% en oportunidad de costos puede cubrir el primer año.",
      roiNote: "El ahorro en mano de obra también es real — la mayoría elimina 6–10 horas semanales de entrada de datos.",
      featuresLabel: "El Mecanismo de Prueba",
      featuresTitle: "Escanea. Estructura. Encuentra la Oportunidad.",
      featuresSubtitle:
        "Cada flujo de trabajo está impulsado por la cámara de tu teléfono — cada uno alimentando una visión más clara de los costos de alimentos.",
      seeAllFeatures: "Ver todas las funciones",
      features: [
        {
          title: "Escaneo de Menú → Mapa de Costos",
          desc: "Fotografía tu menú impreso y cada plato es extraído automáticamente. Tu menú se convierte en la base para el costeo de recetas, la revisión de facturas y la identificación de oportunidades de costos.",
        },
        {
          title: "Conteo con Teléfono → Real vs. Teórico",
          desc: "Camina por tus estantes con tu teléfono. Los conteos alimentan directamente los reportes de varianza — para que veas la brecha entre lo que debiste haber gastado y lo que gastaste.",
        },
        {
          title: "Reportes de Varianza → Encuentra la Fuga",
          desc: "La varianza del Costo Teórico de Alimentos muestra exactamente a dónde van los márgenes. Compara el gasto esperado con el real e identifica desperdicios, exceso de porciones y merma.",
        },
        {
          title: "Escaneo de Facturas → Seguimiento de Precios",
          desc: "Fotografía una entrega de proveedor y cada cambio de precio es capturado automáticamente. Los aumentos de precio fluyen instantáneamente a los costos de recetas.",
        },
        {
          title: "Multi-sucursal",
          desc: "Gestiona inventario, recetas y equipo en cada sucursal desde una sola cuenta. Pro agrega órdenes de transferencia entre tiendas y reportes multi-sucursal.",
        },
        {
          title: "Costeo de Recetas en Vivo",
          desc: "Los precios de ingredientes fluyen directamente desde las facturas de proveedores a tus recetas. Las sub-recetas anidadas se recalculan en el orden correcto. Tu costo de alimentos siempre está actualizado.",
        },
      ],
      recipeLabel: "Costeo de Recetas",
      recipeTitle: "Costo Real por Plato — De Foto a Número",
      recipeSubtitle:
        "Las estimaciones de costo de alimentos comienzan de inmediato una vez que los ingredientes se emparejan con el inventario y los precios de proveedores. Fotografía una tarjeta de receta y ve el costo actual del plato.",
      recipeNote: "El costeo de recetas está incluido en todos los planes de pago.",
      seePlans: "Ver planes",
      recipeSteps: [
        {
          num: "1",
          title: "Fotografía tu receta",
          body: "Apunta tu teléfono a cualquier tarjeta de receta o nota impresa. Cada ingrediente es leído de la foto — cantidades, unidades y todo.",
        },
        {
          num: "2",
          title: "El costo de alimentos comienza a emerger",
          body: "Los ingredientes se emparejan con tu inventario y precios de proveedores. Establece porcentajes de merma y obtén el costo real por porción — y alertas cuando un precio haya cambiado desde tu último conteo.",
        },
        {
          num: "3",
          title: "Captura cada cambio de precio",
          body: "Cada receta se actualiza automáticamente cuando cambian los precios de los proveedores. Las sub-recetas anidadas se recalculan en el orden correcto. Siempre conoces el costo actual.",
        },
      ],
      howItWorksLabel: "El Recorrido de Lanzamiento Guiado",
      howItWorksTitle: "Comienza con tu Menú. Alcanza el Conocimiento de Costos en 14 Días.",
      howItWorksSubtitle:
        "FnB Cost Pro está diseñado para poner en marcha tu primera sucursal en una tarde con un lanzamiento guiado — y comenzar a identificar oportunidades de costos dentro de 14 días.",
      steps: [
        {
          num: "01",
          title: "Escanea tu menú",
          body: "Sube una foto de tu menú impreso. Cada plato, sección y precio es extraído y llena tu biblioteca de recetas en minutos — dándote el mapa de partida para la revisión de costos.",
        },
        {
          num: "02",
          title: "Revisa facturas y precios de proveedores",
          body: "Fotografía tus facturas o importa tus guías de pedidos. Cada precio llega automáticamente a tus costos de recetas — para que veas dónde se están moviendo los costos de ingredientes.",
        },
        {
          num: "03",
          title: "Identifica tu primera oportunidad de ahorro",
          body: "En 14 días, tu sesión de lanzamiento guiado revisa tu menú, recetas, facturas y datos de varianza para identificar al menos un área donde los costos puedan estar escapándose.",
        },
      ],
      ctaBottomTitle: "¿Listo para Encontrar tu Primera Oportunidad de Ahorro?",
      ctaBottomSubtitle:
        "Danos 14 días. Te ayudaremos a identificar al menos un área donde los costos de alimentos pueden estar escapándose — usando tu menú, recetas, facturas, precios de proveedores o proceso de inventario.",
      ctaBottomTrial: "Inicia tu Revisión de 14 Días",
      ctaBottomContact: "Contáctanos",
      ctaChecklist: [
        "Garantía de oportunidad en costos de 14 días",
        "Cancela en cualquier momento",
        "Lanzamiento guiado en una tarde",
        "Identifica al menos una oportunidad de ahorro",
      ],
      stepLabel: "Paso",
      mobileShowcaseTitle: "Cada flujo de trabajo alimenta la visibilidad de costos",
      mobileShowcaseSubtitle:
        "Cuenta inventario, escanea facturas, costea recetas — cada uno cerrando el ciclo entre lo que gastas y lo que deberías gastar. Sin necesidad de descargar una app.",
      mobilePhoneLabels: [
        "Real vs. teórico — encuentra la varianza",
        "Captura cambios de precios automáticamente",
        "Costo real por plato — siempre actualizado",
      ],
      mobileCallouts: [
        { label: "Visibilidad de costos", sub: "Cada escaneo alimenta mayor claridad en costos" },
        { label: "Siempre actualizado", sub: "Los cambios de precio actualizan recetas al instante" },
        { label: "Real vs. teórico", sub: "Los conteos alimentan directamente los reportes de varianza" },
      ],
      menuScanCTA: "Escanea tu menú",
      menuScanMockTitle: "Escaneo de menú completo",
      menuScanMockSub: "Brian's Bistro — 3 secciones, 42 ítems",
      menuScanMockSections: [
        { section: "Entradas", count: "8 ítems", avg: "prom $12.50" },
        { section: "Platos principales", count: "18 ítems", avg: "prom $24.00" },
        { section: "Postres", count: "6 ítems", avg: "prom $9.75" },
        { section: "Bebidas", count: "10 ítems", avg: "prom $6.50" },
      ],
      menuScanMockFooter: "42 ítems listos para costeo de recetas",
      menuScanMockStatus: "Mapa inicial creado",
    },
    features: {
      meta: {
        title: "Funcionalidades de la Plataforma — FnB Cost Pro Plataforma de Operaciones Culinarias",
        description:
          "Explora las capacidades de FnB Cost Pro: escaneo de menú, costeo de recetas, captura de facturas, conteo de inventario, conectividad con proveedores y gestión multi-sucursal.",
      },
      badge: "Funciones",
      headline: "La visibilidad de costos comienza con una foto",
      subheadline:
        "FnB Cost Pro convierte tus menús, tarjetas de recetas, facturas de proveedores y conteos de inventario en un sistema de costos funcional — más rápido que la entrada manual, con un proceso guiado de 14 días para encontrar al menos una oportunidad de ahorro.",
      badgesNote: "las insignias indican qué plan incluye cada función",
      startFree: "Inicia tu Revisión de 14 Días",
      heroSecondaryCtaLabel: "Ver el escaneo de menú",
      heroProofLine: "Garantía de oportunidad de 14 días. Cancela en cualquier momento.",
      upgradeTitle: "El plan correcto para tu operación",
      upgradeSubtitle: "Comienza con una prueba de 14 días. Cancela cuando quieras.",
      upgradeFreeTitle: "",
      upgradeFreebody: "",
      upgradeStarterTitle: "Starter — Una sucursal",
      upgradeStarterBody:
        "Todo lo que necesitas para una sucursal: escaneo de menú y recetas por foto, costeo de recetas en vivo, guías de proveedores, conteos de inventario y reportes de varianza del Costo Teórico de Alimentos.",
      upgradeBasicTitle: "Starter — Conoce tus costos",
      upgradeBasicBody:
        "Configuración por foto, costeo de recetas en vivo, guías de proveedores, reportes de varianza del Costo Teórico de Alimentos y el asistente de cocina. Todo lo que necesitas para una sucursal.",
      upgradeProTitle: "Pro — Control multi-sucursal",
      upgradeProBody:
        "Todo lo de Starter más escaneo de estantes por teléfono, órdenes de transferencia, comparación de precios entre proveedores y exportación a QuickBooks. Agrega sucursales ilimitadas a $149/sucursal/mes.",
      ctaTitle: "¿Listo para encontrar tu primera oportunidad de ahorro?",
      ctaSubtitle:
        "Danos 14 días. Te ayudaremos a construir un sistema de costos funcional e identificar al menos un área donde los costos de alimentos pueden estar escapándose.",
      getStartedFree: "Inicia tu Revisión de 14 Días",
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
