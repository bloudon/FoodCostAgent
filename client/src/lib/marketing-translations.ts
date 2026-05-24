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
      tagline: "Photo-first inventory management and recipe costing for restaurants and Food & Beverage businesses.",
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
        title: "FnB Cost Pro — Find Your First Food Cost Savings Opportunity in 14 Days",
        description:
          "FnB Cost Pro helps restaurants turn menus, recipes, invoices, vendor pricing, and inventory data into clear food cost insight — starting with a guided launch designed to uncover at least one savings opportunity in your first 14 days.",
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
        title: "Restaurant Food Cost Software Features | FnB Cost Pro",
        description:
          "FnB Cost Pro helps restaurants turn menus, recipes, invoices, and inventory counts into food cost insight. Start with a guided 14-day process designed to find at least one savings opportunity.",
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
        title: "Pricing — FnB Cost Pro Restaurant Inventory & Food Cost Software",
        description:
          "Simple, transparent pricing for restaurant inventory management and BOH software. Starter at $149/mo for one location, Pro from $228/mo for multi-location, Enterprise custom. 14-day free trial.",
      },
      badge: "Simple, Transparent Pricing",
      headline: "A Plan for Every Operation",
      subheadline:
        "All paid plans include photo-based setup, live recipe costing, vendor order guides, and a 14-day free trial. Cancel anytime.",
      termLabels: { monthly: "Monthly", annual: "Annual" },
      savings: { monthly: null, annual: "Save ~14%" },
      mostPopular: "Most Popular",
      recommendedForYou: "Recommended for You",
      custom: "Custom",
      pricingUnavailable: "Pricing not available",
      startFreeTrial: "Start 14-Day Free Trial",
      contactSales: "Contact Sales",
      noCardRequired: "Cancel anytime",
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
          a: "There's no permanent free plan — but every paid plan comes with a 14-day free trial with full access. Cancel anytime.",
        },
        {
          q: "How fast does it pay for itself?",
          a: "Starter costs $149/month. At $18/hour, that's about 8 hours of saved data entry. Most operators spend more than that every week just on invoice keying and recipe setup. The software typically pays for itself in the first week.",
        },
        {
          q: "What's included in the free trial?",
          a: "Full access to all features in the plan you choose for 14 days. Photo scanning, recipe costing, vendor order guides, everything. You won't be charged until the trial ends, and you can cancel any time before then.",
        },
        {
          q: "How does Pro per-location billing work?",
          a: "Pro is billed as a platform fee ($79/month) plus a per-store fee ($149/store/month). Your first location costs $228/month total. Annual billing lowers this to $69 + $129/store. The per-store rate scales naturally — more stores means more value from cross-location reporting and transfer orders.",
        },
        {
          q: "Do you charge setup fees?",
          a: "No mandatory setup fees. Guided onboarding is included in every plan. Optional white-glove onboarding is available if you want hands-on help: $299 for Starter, $999 for Pro multi-store.",
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
        { label: "Theoretical Food Cost variance reporting", starter: true, pro: true, enterprise: true },
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
        "Menu scan — seed your recipe library from a photo",
        "Recipe scan — photograph recipe cards and get costed recipes",
        "Invoice scan — photograph invoices and auto-match to inventory",
        "Live recipe costing with automatic price updates",
        "Nested sub-recipe support",
        "Vendor order guide imports (Sysco, GFS, US Foods)",
        "Theoretical Food Cost variance reporting",
        "POS sales data import",
        "Smart dashboard",
        "Kitchen assistant",
        "Online chat support",
      ],
      proFeatures: [
        "Unlimited store locations",
        "Everything in Starter",
        "Shelf scan — count inventory with your phone camera",
        "Catch-weight scanning for proteins",
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
        title: "About FnB Cost Pro — We Help Restaurants Find Food Cost Opportunities Faster",
        description:
          "FnB Cost Pro helps restaurants turn menus, recipes, invoices, and inventory data into food cost insight — starting with a 14-day guided process designed to find at least one savings opportunity.",
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
      getStarted: "Iniciar prueba gratis",
      myAccount: "Mi cuenta",
      goToDashboard: "Ir al panel",
      signOut: "Cerrar sesión",
      signingOut: "Cerrando sesión…",
    },
    footer: {
      tagline: "Gestión de inventario foto-primero y costeo de recetas para restaurantes y negocios de Alimentos y Bebidas.",
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
        title: "FnB Cost Pro — Encuentra tu Primera Oportunidad de Ahorro en Costos en 14 Días",
        description:
          "FnB Cost Pro ayuda a los restaurantes a convertir menús, recetas, facturas, precios de proveedores e inventario en información clara sobre costos de alimentos — comenzando con un lanzamiento guiado para descubrir al menos una oportunidad de ahorro en tus primeros 14 días.",
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
        title: "Funciones — FnB Cost Pro Gestión de Inventario y Cocina Trasera para Restaurantes",
        description:
          "Explora las funciones de gestión de inventario para restaurantes de FnB Cost Pro: escaneo por foto, conteos de inventario desde el teléfono y control de costos en cada sucursal.",
      },
      badge: "Primero la foto. Sin teclado.",
      headline: "Tu cocina trasera — gestionada desde tu teléfono",
      subheadline:
        "FnB Cost Pro elimina la entrada de datos por teclado. Apunta tu cámara a tu menú, recetas, facturas, estantes. La app hace el resto.",
      badgesNote: "las insignias indican qué plan incluye cada función",
      startFree: "Iniciar prueba gratis",
      upgradeTitle: "El plan correcto para tu operación",
      upgradeSubtitle: "Comienza con una prueba de 14 días. Sin tarjeta de crédito.",
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
        "Todo lo de Starter más escaneo de estantes por teléfono, órdenes de transferencia, comparación de precios entre proveedores, exportación a QuickBooks y sucursales ilimitadas.",
      ctaTitle: "Inicia tu prueba gratuita de 14 días",
      ctaSubtitle:
        "Acceso completo desde el primer día. Configuración por foto incluida. Cancela cuando quieras.",
      getStartedFree: "Iniciar prueba gratis",
      tierLabels: { free: "Gratis", basic: "Starter", pro: "Pro" },
      sections: [],
      groups: [
        {
          title: "Configura con una foto",
          description:
            "Fotografía tu menú, tarjetas de recetas y facturas de proveedores. Los datos se extraen de cada foto y tu sistema se construye automáticamente.",
          features: [
            "Escaneo de menú: fotografía tu menú impreso y llena tu biblioteca al instante",
            "Escaneo de recetas: fotografía tarjetas de recetas y obtén recetas costeadas en segundos",
            "Escaneo de facturas: fotografía facturas y auto-emparejar con inventario",
            "Funciona con menús impresos, PDFs, tarjetas escritas a mano y capturas digitales",
            "Ingredientes, cantidades, unidades y precios extraídos automáticamente",
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
          title: "Varianza del Costo Teórico de Alimentos",
          description:
            "Deja de adivinar a dónde va tu costo de alimentos. Los reportes de varianza del Costo Teórico de Alimentos muestran exactamente dónde está la brecha.",
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
            "Camina por tus estantes con tu teléfono en lugar de un portapapeles. Las etiquetas se leen y los conteos se registran directamente en tu sesión de inventario del restaurante — más rápido y sin errores de transcripción.",
          features: [
            "Escaneo de estantes: las etiquetas se leen y los conteos se registran",
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
        title: "Precios — FnB Cost Pro Software de Inventario y Gestión para Restaurantes",
        description:
          "Precios transparentes para software de gestión de inventario para restaurantes. Starter $149/mes, Pro desde $228/mes para múltiples sucursales, Enterprise personalizado. Prueba gratuita de 14 días.",
      },
      badge: "Precios simples y transparentes",
      headline: "Un plan para cada operación",
      subheadline:
        "Todos los planes de pago incluyen configuración por foto, costeo de recetas en vivo, guías de proveedores y prueba gratuita de 14 días.",
      termLabels: { monthly: "Mensual", annual: "Anual" },
      savings: { monthly: null, annual: "Ahorra ~14%" },
      mostPopular: "Más popular",
      recommendedForYou: "Recomendado para ti",
      custom: "Personalizado",
      pricingUnavailable: "Precio no disponible",
      startFreeTrial: "Iniciar prueba de 14 días",
      contactSales: "Contactar ventas",
      noCardRequired: "Cancela cuando quieras",
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
          a: "Sin cargos de configuración obligatorios. La incorporación guiada está incluida en todos los planes. La incorporación personalizada es opcional: $299 para Starter, $999 para Pro multi-sucursal.",
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
        { label: "Reportes de varianza del Costo Teórico de Alimentos", starter: true, pro: true, enterprise: true },
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
        "Escaneo de menú por foto",
        "Escaneo de recetas por foto",
        "Escaneo de facturas por foto",
        "Costeo de recetas en vivo",
        "Sub-recetas anidadas",
        "Guías de proveedores (Sysco, GFS, US Foods)",
        "Reportes de varianza del Costo Teórico de Alimentos",
        "Importación de ventas POS",
        "Panel inteligente",
        "Asistente de cocina",
        "Soporte por chat",
      ],
      proFeatures: [
        "Sucursales ilimitadas",
        "Todo lo de Starter",
        "Escaneo de estantes por teléfono",
        "Escaneo de peso-captura",
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
        title: "Nosotros — FnB Cost Pro Ayuda a Restaurantes a Encontrar Oportunidades de Ahorro en Costos",
        description:
          "FnB Cost Pro ayuda a los restaurantes a convertir menús, recetas, facturas e inventario en información sobre costos de alimentos — comenzando con un proceso guiado de 14 días para encontrar al menos una oportunidad de ahorro.",
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
