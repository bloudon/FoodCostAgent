/**
 * Translations for the 6 new destination pages added in the nav restructure:
 * Platform, For Chefs, For F&B Leaders, and three Industry pages.
 *
 * Kept separate from marketing-translations.ts to avoid growing that file
 * further. Pages import this directly alongside useLanguage() for lang.
 */

import type { Language } from "./marketing-translations";

// ─────────────────────────────────────────────────────────────────────────────

const en = {
  platform: {
    meta: {
      title: "Platform — FnB Cost Pro Culinary Operations Platform",
      description:
        "Recipe intelligence, inventory by location, live vendor pricing, predictive ordering and mobile capture — one platform for chef-led restaurants and F&B operations.",
    },
    badge: "The Platform",
    headline: "Every capability your operation needs. One platform.",
    subheadline:
      "FnB Cost Pro connects recipe costing, inventory management, vendor pricing and purchasing intelligence — built for kitchens that work by phone, not by spreadsheet.",
    ctaPrimary: "Schedule a Culinary Review",
    ctaSecondary: "See How It Works",
    sections: [
      {
        id: "recipes",
        eyebrow: "Recipe Intelligence",
        headline: "Recipes that cost themselves.",
        body: "Every recipe in FnB Cost Pro is priced from live vendor data. When a distributor price changes, every recipe using that ingredient recalculates automatically. Nested sub-recipes update in the correct dependency order — no spreadsheet, no manual entry.",
        bullets: [
          "Photograph recipe cards — ingredients and quantities extracted automatically",
          "Ingredients matched to your inventory for team review before saving",
          "Sub-recipes and preparations nest correctly with their own yield adjustments",
          "Recipe costs update when vendor pricing changes",
          "Scale recipes without losing the costed ingredient relationship",
        ],
        screenshot: "/screenshots/recipe-costing.png",
        screenshotAlt: "FnB Cost Pro recipe costing — live cost per portion from vendor pricing",
      },
      {
        id: "inventory",
        eyebrow: "Inventory & Locations",
        headline: "Count by phone. Know what you have.",
        body: "Inventory counting is one of the most time-consuming recurring tasks in any professional kitchen. FnB Cost Pro turns the count process into a phone-first workflow — organized by your actual storage layout and updated in real time.",
        bullets: [
          "Shelf scan — photograph product labels to log counts by storage location",
          "Catch-weight scanning for proteins and by-weight items",
          "Items grouped by physical location so staff count aisle by aisle",
          "Running cost totals update as each count is entered",
          "Historical count data shows how on-hand quantities move over time",
        ],
        screenshot: "/screenshots/inventory-counting.png",
        screenshotAlt: "FnB Cost Pro inventory counting — organized by storage location",
      },
      {
        id: "vendors",
        eyebrow: "Vendor Intelligence",
        headline: "Live pricing from the order guides you already use.",
        body: "Capture account-specific vendor pricing from supported distributor portals and existing files. Price history tracks where costs have moved. Cross-order-guide comparisons surface where a line item has shifted across your distributor relationships.",
        bullets: [
          "Order guide imports from Sysco, GFS, US Foods and major distributors",
          "Account-specific pricing from supported portals and uploaded files",
          "Invoice scan captures delivered prices per line item at receiving",
          "Price history shows cost movement over time for every item",
          "Cross-vendor comparison when pricing is available from multiple guides",
          "Recipe costs recalculate automatically when vendor pricing updates",
        ],
        screenshot: "/screenshots/vendor-order-guides.png",
        screenshotAlt: "FnB Cost Pro vendor order guides — price tracking and comparison",
      },
      {
        id: "predictive-ordering",
        eyebrow: "Predictive Ordering",
        headline: "Order recommendations when the data supports them.",
        body: "As purchase history accumulates, FnB Cost Pro can suggest order quantities based on usage patterns, par levels and lead times. Purchase order workflows connect receiving to inventory and recipe costs — every delivery tracked, every price change applied.",
        bullets: [
          "Purchase order creation and full receiving workflow",
          "Par level management per location and storage area",
          "Order quantity suggestions based on usage history when data supports it",
          "Received deliveries update inventory and trigger recipe cost recalculation",
          "Vendor order history by item and distributor relationship",
        ],
        screenshot: "/screenshots/inventory-management.png",
        screenshotAlt: "FnB Cost Pro inventory management — par levels and order history",
      },
      {
        id: "mobile-capture",
        eyebrow: "Mobile Capture",
        headline: "Built for the way kitchens move.",
        body: "Every capture workflow in FnB Cost Pro works on a phone or tablet. No dedicated hardware required. Chefs photograph recipe cards on the line. Receiving staff scan invoices at the dock. Inventory teams count by barcode. Everything lands in the same system.",
        bullets: [
          "Photograph recipe cards, menus, and invoices from any phone",
          "Barcode scan for inventory count sessions",
          "Catch-weight scale photography for proteins",
          "Mobile count companion organized by storage location",
          "Works in a browser on iOS and Android — no app store download",
        ],
        screenshot: "/screenshots/mobile-count-items.jpg",
        screenshotAlt: "FnB Cost Pro mobile inventory companion — count by location on your phone",
      },
      {
        id: "integrations",
        eyebrow: "Integrations",
        headline: "Connects to what your kitchen already uses.",
        body: "FnB Cost Pro integrates with the POS systems, accounting platforms, and distributor portals most operations already have. Sales data from your POS feeds Theoretical Food Cost variance reporting. QuickBooks export keeps your accountant up to date.",
        bullets: [
          "POS integration for Theoretical Food Cost variance reporting",
          "QuickBooks export for received purchase orders",
          "Vendor portal connections — Sysco, GFS, US Foods and supported distributors",
          "API access for custom integrations (Enterprise Operations)",
          "Import and export workflows for operations not yet on connected portals",
        ],
        screenshot: "/screenshots/food-cost-variance.png",
        screenshotAlt: "FnB Cost Pro food cost variance reporting — actual vs. theoretical",
      },
    ],
    ctaTitle: "Ready to see how it works in your operation?",
    ctaSubtitle:
      "Connect with our team. We'll walk through your current setup, answer your questions and confirm whether FnB Cost Pro is the right fit.",
    ctaButton: "Schedule a Culinary Review",
  },

  forChefs: {
    meta: {
      title: "For Chefs — FnB Cost Pro Culinary Operations Platform",
      description:
        "FnB Cost Pro is built for culinary teams who work by photo, not by spreadsheet. Recipe capture, live costing, sub-recipes, phone-first workflows — less entry, more intelligence.",
    },
    badge: "For Chefs",
    headline: "The platform that works the way you work.",
    subheadline:
      "FnB Cost Pro is designed so culinary teams can capture, cost, and manage their work without sitting at a computer.",
    ctaPrimary: "Schedule a Culinary Review",
    sections: [
      {
        eyebrow: "Capture",
        headline: "Start with a photo of what you already have.",
        body: "Recipe cards written in a chef's hand. Menus printed for service. Invoices from the morning delivery. FnB Cost Pro reads all of these from photos — so the data exists in the system without the team re-typing it.",
        bullets: [
          "Photograph handwritten recipe cards — ingredients extracted automatically",
          "Scan printed menus — dishes, sections, and prices captured",
          "Invoice photos capture delivered prices per line item",
          "Works with photos, PDFs, and existing spreadsheet exports",
        ],
      },
      {
        eyebrow: "Specials",
        headline: "Cost a new special in minutes.",
        body: "When the evening special changes, the recipe cost should too. Photograph the new recipe card, review the extracted ingredients, confirm the match to current vendor pricing, and the cost is live.",
        bullets: [
          "New recipe from a photo in a few taps",
          "Ingredients match to current vendor pricing automatically",
          "Cost recalculates when the special is confirmed",
          "Copy and adapt an existing recipe as a starting point",
        ],
      },
      {
        eyebrow: "Sub-Recipes",
        headline: "Complex preparations costed correctly.",
        body: "Most recipe costing tools flatten preparations into a list of raw ingredients. FnB Cost Pro supports nested sub-recipes — a braise, a stock, a compound butter, a cured item — each costed as itself, with its own yield, used as an ingredient in other recipes.",
        bullets: [
          "Nest preparations as sub-recipes with their own yield",
          "Sub-recipe costs flow into every parent recipe that uses them",
          "Yield adjustments at each level of nesting",
          "Costing updates cascade through the dependency chain when prices change",
        ],
      },
      {
        eyebrow: "Live Costing",
        headline: "Food cost that stays current without manual updates.",
        body: "Recipe costs in FnB Cost Pro update when vendor prices change — automatically, when the invoice is received. Every recipe always shows its current cost.",
        bullets: [
          "Unit costs update from delivered invoice prices",
          "Recipe cost recalculates across every dish that uses the ingredient",
          "Historical cost comparison shows how margin has moved over time",
          "Sub-recipe recalculation cascades in the correct dependency order",
        ],
      },
      {
        eyebrow: "Phone-First",
        headline: "Built for a kitchen, not a desk.",
        body: "Inventory counts, invoice capture, recipe photography — every workflow in FnB Cost Pro is designed to be completed on a phone or tablet from the floor of your kitchen. No laptop required for regular tasks.",
        bullets: [
          "Count inventory by barcode scan using your phone",
          "Photograph invoices at receiving without leaving the dock",
          "Recipe cards captured on the line or in prep",
          "Mobile companion for counts, waste log, and receiving",
        ],
      },
      {
        eyebrow: "Vendor Management",
        headline: "Swap a vendor item and keep your recipes intact.",
        body: "When a distributor discontinues a SKU or you switch to a new vendor, FnB Cost Pro lets you re-link that ingredient to a new item without rebuilding every recipe that uses it.",
        bullets: [
          "Re-link an inventory item to a new vendor SKU",
          "All recipes using that item update automatically",
          "Price history tracks cost before and after the switch",
          "Multiple vendor sources per item for cross-vendor comparison",
        ],
      },
      {
        eyebrow: "Less Entry",
        headline: "Capture once. The platform does the rest.",
        body: "Each scan, photograph, or upload replaces a data entry task. The goal is not to eliminate operational knowledge — it is to stop asking culinary teams to re-enter what they already know.",
        bullets: [
          "Menu scan seeds the recipe library automatically",
          "Invoice scan updates vendor pricing without manual entry",
          "Inventory import from existing count sheets and spreadsheets",
          "Photo-based capture works with the materials your kitchen already has",
        ],
      },
    ],
    ctaTitle: "Want to see how it works in your kitchen?",
    ctaSubtitle:
      "Connect with our team. We'll review your current setup and confirm whether FnB Cost Pro is the right fit for your kitchen.",
    ctaButton: "Schedule a Culinary Review",
  },

  forFbLeaders: {
    meta: {
      title: "For F&B Leaders — FnB Cost Pro Culinary Operations Platform",
      description:
        "Multi-operation visibility, vendor pricing intelligence, standardized recipe costs, and financial variance insight — built for F&B directors, executive chefs, and multi-unit operators.",
    },
    badge: "For F&B Leaders",
    headline: "Operational intelligence for every kitchen you run.",
    subheadline:
      "FnB Cost Pro gives F&B directors, executive chefs, and multi-unit operators a clear view of what each operation costs — and where costs are moving.",
    ctaPrimary: "Schedule a Culinary Review",
    sections: [
      {
        eyebrow: "Multi-Operation",
        headline: "Every location in one view.",
        body: "One account holds every operation. Per-location counts, variance reports, and recipe costs are visible from the same management view. Compare performance across kitchens without pulling spreadsheets.",
        bullets: [
          "All operations under one account",
          "Per-location inventory counts and cost reports",
          "Cross-location variance reporting",
          "Consolidated management view of where each kitchen stands",
        ],
      },
      {
        eyebrow: "Standardization",
        headline: "One recipe library. Every kitchen.",
        body: "Central recipe libraries ensure every kitchen costs the same dish the same way. Updates to a shared recipe propagate to all locations that use it. Consistency starts with the data.",
        bullets: [
          "Central recipe library shared across all locations",
          "Per-location yield overrides where preparation varies",
          "Recipe changes propagate automatically to all locations",
          "Location-level costing reflects each kitchen's actual vendor pricing",
        ],
      },
      {
        eyebrow: "Vendor Pricing",
        headline: "Account-specific pricing from the distributors you use.",
        body: "Capture pricing from your actual distributor accounts — not catalog prices, but the negotiated rates your operation has established. Cross-shop comparisons surface where pricing has drifted across your vendor relationships.",
        bullets: [
          "Account-specific pricing from supported distributor portals",
          "Order guide imports from Sysco, GFS, US Foods and others",
          "Cross-vendor comparison across all active order guides",
          "Price movement history shows where costs have trended",
        ],
      },
      {
        eyebrow: "Predictive Purchasing",
        headline: "Orders informed by usage, not habit.",
        body: "Purchase order workflows connect to inventory and recipe costs. As purchase history accumulates, order quantity suggestions are based on actual usage patterns — not standing orders that may no longer reflect current volumes.",
        bullets: [
          "Purchase order creation with full receiving workflow",
          "Order quantity recommendations based on usage history",
          "Par levels by location and storage area",
          "Receiving updates inventory and recipe costs automatically",
        ],
      },
      {
        eyebrow: "Inventory",
        headline: "Counts that reflect your actual storage layout.",
        body: "Inventory is organized by physical storage location — walk-in, dry storage, freezer, bar. Counts are entered by location so the on-hand value is accurate down to where each item actually sits.",
        bullets: [
          "Storage location management per kitchen",
          "Counts organized by physical layout for efficient counting",
          "Catch-weight scanning for proteins and by-weight items",
          "Historical count data shows on-hand trends over time",
        ],
      },
      {
        eyebrow: "Review Workflows",
        headline: "Nothing is saved without team review.",
        body: "Every extraction — recipe, invoice, inventory — goes through a review workflow before it is applied to the system. The team confirms the match and pricing before anything is saved. Accuracy is a process, not a promise.",
        bullets: [
          "Extracted recipe ingredients reviewed before saving",
          "Invoice line items confirmed before pricing updates apply",
          "Inventory imports reviewed before count values change",
          "Role-based access for admin, management and kitchen staff",
        ],
      },
      {
        eyebrow: "Financial Insight",
        headline: "What you should have spent vs. what you did.",
        body: "Theoretical Food Cost shows what the kitchen should have spent based on POS sales and recipe costs. Compare it to actual spend to surface signs of waste, over-portioning, or shrinkage — by category, by location, and over time.",
        bullets: [
          "Theoretical Food Cost from POS sales × recipe costs",
          "Actual vs. theoretical comparison by category",
          "Variance by location for multi-operation comparisons",
          "Date-range reporting and trend analysis",
          "QuickBooks export for accounting reconciliation",
        ],
      },
    ],
    ctaTitle: "Ready to see how it works across your operations?",
    ctaSubtitle:
      "Connect with our team. We'll walk through your current setup, answer your questions and confirm whether FnB Cost Pro is the right fit.",
    ctaButton: "Schedule a Culinary Review",
  },

  industryChefLed: {
    meta: {
      title: "Chef-Led Restaurants — FnB Cost Pro",
      description:
        "FnB Cost Pro helps chef-led restaurants capture recipe costs, track vendor pricing and manage inventory — without the admin overhead. Photo-first workflows built for culinary teams.",
    },
    badge: "Chef-Led Restaurants",
    headline: "Run the back of house with the same precision as the front.",
    subheadline:
      "Chef-led restaurants live on culinary quality and tight margins. FnB Cost Pro gives the kitchen the operational tools to protect both — without adding admin burden.",
    challenge: {
      eyebrow: "The Challenge",
      headline: "Culinary precision without the back-office overhead.",
      body: "Chef-led restaurants are typically run by culinary teams with limited admin support. Recipe documentation, vendor invoice tracking, and inventory management fall on the same people who are cooking. Most back-office tools expect those people to have hours of data entry time they don't have.",
      bullets: [
        "Recipes live on index cards and in chefs' heads — not in any system",
        "Vendor pricing is rarely current because manual entry takes too long",
        "Inventory counts depend on clipboards and spreadsheets that drift",
        "Food cost visibility comes weeks after the fact, if at all",
      ],
    },
    howItWorks: {
      eyebrow: "How It Works",
      headline: "Photo-first setup. Live data. No data-entry overhead.",
      body: "FnB Cost Pro turns the materials the kitchen already has — handwritten recipe cards, printed menus, vendor invoices — into a working cost system. Chefs photograph rather than re-type. The system extracts, structures, and prices.",
      bullets: [
        "Photograph recipe cards — ingredients extracted and costed from vendor pricing",
        "Invoice scan captures delivered prices from every delivery at receiving",
        "Vendor order guide imports from Sysco, GFS, US Foods and others",
        "Inventory counts by phone — organized by your storage layout",
        "Recipe costs update automatically when vendor prices change",
        "Sub-recipes and preparations nested with their own yields",
      ],
    },
    screenshot: "/screenshots/recipe-card-phone-scene.png",
    screenshotAlt: "Capturing a handwritten recipe card with FnB Cost Pro",
    ctaTitle: "Ready to see how it works in your kitchen?",
    ctaSubtitle:
      "Connect with our team. We'll review your current operation and confirm whether FnB Cost Pro is the right fit — before you commit to anything.",
    ctaButton: "Schedule a Culinary Review",
  },

  industryGroups: {
    meta: {
      title: "Restaurant Groups — FnB Cost Pro",
      description:
        "FnB Cost Pro helps restaurant groups standardize recipe costs, track vendor pricing across locations, and compare performance across every kitchen from one account.",
    },
    badge: "Restaurant Groups",
    headline: "Consistent costs across every kitchen.",
    subheadline:
      "Restaurant groups need recipe consistency, cross-location visibility, and vendor pricing that reflects every operation. FnB Cost Pro is built for that scale.",
    challenge: {
      eyebrow: "The Challenge",
      headline: "Consistency breaks down as groups grow.",
      body: "As groups expand, the gap between how recipes are costed at each location widens. Vendor pricing is negotiated centrally but tracked locally — or not at all. Cross-location variance is only visible in the P&L, by which point it is too late to course-correct.",
      bullets: [
        "Recipes costed differently at each location using different assumptions",
        "No centralized vendor pricing visibility across all order guides",
        "Cross-location variance reporting requires manual export and comparison",
        "Kitchen managers operating with different data quality at each location",
      ],
    },
    howItWorks: {
      eyebrow: "How It Works",
      headline: "One account. Every operation.",
      body: "FnB Cost Pro manages all operations under one account. Central recipe libraries ensure consistent costing. Location-level vendor pricing reflects each operation's actual order guides. Cross-location variance reporting shows where each kitchen stands — from one management view.",
      bullets: [
        "Central recipe library shared across all locations",
        "Per-location vendor pricing and order guide management",
        "Cross-location variance and cost comparison reporting",
        "Transfer orders between locations",
        "Role-based access — regional, management and kitchen staff tiers",
        "One view of all operations from the management account",
      ],
    },
    screenshot: "/screenshots/multi-location.png",
    screenshotAlt: "FnB Cost Pro multi-location management — cross-location visibility",
    ctaTitle: "Ready to see how it works across your group?",
    ctaSubtitle:
      "Connect with our team. We'll walk through how FnB Cost Pro handles your specific multi-location setup — before you commit to anything.",
    ctaButton: "Schedule a Culinary Review",
  },

  industryClubs: {
    meta: {
      title: "Clubs & Resorts — FnB Cost Pro",
      description:
        "FnB Cost Pro supports multi-outlet F&B operations at clubs, resorts, and hotels — each outlet with its own inventory, vendor relationships and recipe library, all visible from one account.",
    },
    badge: "Clubs & Resorts",
    headline: "F&B intelligence for complex multi-outlet operations.",
    subheadline:
      "Clubs and resorts operate multiple F&B outlets simultaneously — dining rooms, bars, banquet facilities, casual outlets. FnB Cost Pro handles that complexity without requiring a separate system for each outlet.",
    challenge: {
      eyebrow: "The Challenge",
      headline: "Multiple outlets. Multiple systems. No single view.",
      body: "Clubs and resorts often operate several F&B outlets simultaneously, each with its own menu, vendor relationships, and cost structure. Managing these as separate spreadsheets or disconnected systems makes consistent cost reporting across the property nearly impossible.",
      bullets: [
        "Multiple F&B outlets under one property — each managed separately",
        "Banquet and events production with variable recipe quantities by event",
        "Different vendor relationships and negotiated pricing per outlet",
        "No consolidated view of food cost performance across the full property",
      ],
    },
    howItWorks: {
      eyebrow: "How It Works",
      headline: "One platform. Every outlet.",
      body: "FnB Cost Pro's Enterprise Operations scope is designed for clubs, resorts, and multi-outlet properties. All outlets are managed under one account — each with its own inventory, vendor pricing, and recipe library — while management has a consolidated view across the property.",
      bullets: [
        "Multi-outlet management under one account",
        "Per-outlet inventory, recipe library and vendor access",
        "Banquet recipe costing for variable-quantity event production",
        "Cross-outlet variance reporting and cost comparison",
        "Custom configuration and structured implementation for complex setups",
        "SLA-backed support for enterprise operations",
      ],
    },
    screenshot: "/screenshots/multi-location.png",
    screenshotAlt: "FnB Cost Pro multi-outlet management for clubs and resorts",
    ctaTitle: "Running a complex F&B operation?",
    ctaSubtitle:
      "Connect with our team. We'll review your property's F&B structure and confirm whether FnB Cost Pro's Enterprise scope is the right fit.",
    ctaButton: "Schedule a Culinary Review",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────

const es = {
  platform: {
    meta: {
      title: "Plataforma — FnB Cost Pro Plataforma de Operaciones Culinarias",
      description:
        "Inteligencia de recetas, inventario por ubicación, precios de proveedores en vivo, pedidos predictivos y captura móvil — una plataforma para restaurantes liderados por chefs y operaciones de A&B.",
    },
    badge: "La Plataforma",
    headline: "Todas las capacidades que tu operación necesita. Una plataforma.",
    subheadline:
      "FnB Cost Pro conecta el costeo de recetas, la gestión de inventario, los precios de proveedores y la inteligencia de compras — construida para cocinas que trabajan con el teléfono, no con hojas de cálculo.",
    ctaPrimary: "Agendar una Revisión Culinaria",
    ctaSecondary: "Cómo Funciona",
    sections: [
      {
        id: "recipes",
        eyebrow: "Inteligencia de Recetas",
        headline: "Recetas que se costean solas.",
        body: "Cada receta en FnB Cost Pro tiene precio de datos de proveedores en vivo. Cuando el precio de un distribuidor cambia, cada receta que usa ese ingrediente se recalcula automáticamente. Las sub-recetas anidadas se actualizan en el orden de dependencia correcto.",
        bullets: [
          "Fotografía tarjetas de recetas — ingredientes y cantidades extraídos automáticamente",
          "Ingredientes emparejados con tu inventario para revisión del equipo antes de guardar",
          "Sub-recetas y preparaciones anidadas correctamente con sus propios ajustes de rendimiento",
          "Los costos de recetas se actualizan cuando cambian los precios de proveedores",
          "Escala recetas sin perder la relación de ingrediente costeado",
        ],
        screenshot: "/screenshots/recipe-costing.png",
        screenshotAlt: "Costeo de recetas en FnB Cost Pro — costo por porción desde precios de proveedor",
      },
      {
        id: "inventory",
        eyebrow: "Inventario y Ubicaciones",
        headline: "Cuenta con el teléfono. Sabe lo que tienes.",
        body: "El conteo de inventario es una de las tareas recurrentes más laboriosas en cualquier cocina profesional. FnB Cost Pro convierte el proceso de conteo en un flujo de trabajo foto-primero, organizado por tu disposición real de almacenamiento.",
        bullets: [
          "Escaneo de estantes — fotografía etiquetas de productos para registrar conteos por ubicación",
          "Escaneo de peso de captura para proteínas y artículos vendidos por peso",
          "Artículos agrupados por ubicación física para que el personal cuente por pasillo",
          "Los totales de costos se actualizan en tiempo real a medida que se ingresan los conteos",
          "Los datos históricos de conteo muestran cómo cambian las cantidades disponibles con el tiempo",
        ],
        screenshot: "/screenshots/inventory-counting.png",
        screenshotAlt: "Conteo de inventario en FnB Cost Pro — organizado por ubicación de almacenamiento",
      },
      {
        id: "vendors",
        eyebrow: "Inteligencia de Proveedores",
        headline: "Precios en vivo de las guías de pedidos que ya usas.",
        body: "Captura precios específicos de cuenta de proveedores desde portales de distribuidores compatibles y archivos existentes. El historial de precios rastrea dónde se han movido los costos. Las comparaciones entre guías de pedidos muestran dónde ha cambiado una línea a través de tus relaciones con distribuidores.",
        bullets: [
          "Importación de guías de pedidos de Sysco, GFS, US Foods y distribuidores principales",
          "Precios específicos de cuenta desde portales compatibles y archivos cargados",
          "El escaneo de facturas captura los precios entregados por línea en la recepción",
          "El historial de precios muestra el movimiento de costos a lo largo del tiempo",
          "Comparación entre proveedores cuando hay precios disponibles de múltiples guías",
          "Los costos de recetas se recalculan automáticamente cuando se actualizan los precios",
        ],
        screenshot: "/screenshots/vendor-order-guides.png",
        screenshotAlt: "Guías de pedidos de proveedores en FnB Cost Pro — seguimiento y comparación de precios",
      },
      {
        id: "predictive-ordering",
        eyebrow: "Pedidos Predictivos",
        headline: "Recomendaciones de pedidos cuando los datos lo respaldan.",
        body: "A medida que se acumula el historial de compras, FnB Cost Pro puede sugerir cantidades de pedido basadas en patrones de uso, niveles de reposición y tiempos de entrega. Los flujos de órdenes de compra conectan la recepción con el inventario y los costos de recetas.",
        bullets: [
          "Creación de órdenes de compra y flujo completo de recepción",
          "Gestión de niveles de reposición por ubicación y área de almacenamiento",
          "Sugerencias de cantidad de pedido basadas en el historial de uso cuando los datos lo respaldan",
          "Las entregas recibidas actualizan el inventario y activan el recálculo de costos de recetas",
          "Historial de pedidos por artículo y relación con el distribuidor",
        ],
        screenshot: "/screenshots/inventory-management.png",
        screenshotAlt: "Gestión de inventario en FnB Cost Pro — niveles de reposición e historial de pedidos",
      },
      {
        id: "mobile-capture",
        eyebrow: "Captura Móvil",
        headline: "Construido para el movimiento de las cocinas.",
        body: "Todos los flujos de captura en FnB Cost Pro funcionan en un teléfono o tablet. No se requiere hardware dedicado. Los chefs fotografían tarjetas de recetas en la línea. El personal de recepción escanea facturas en el muelle. El equipo de inventario cuenta por código de barras.",
        bullets: [
          "Fotografía tarjetas de recetas, menús y facturas desde cualquier teléfono",
          "Escaneo de código de barras para sesiones de conteo de inventario",
          "Fotografía de báscula de peso de captura para proteínas",
          "Compañero de conteo móvil organizado por ubicación de almacenamiento",
          "Funciona en el navegador en iOS y Android — sin descarga de tienda de aplicaciones",
        ],
        screenshot: "/screenshots/mobile-count-items.jpg",
        screenshotAlt: "Compañero de inventario móvil en FnB Cost Pro — cuenta por ubicación con tu teléfono",
      },
      {
        id: "integrations",
        eyebrow: "Integraciones",
        headline: "Conecta con lo que tu cocina ya usa.",
        body: "FnB Cost Pro se integra con los sistemas POS, plataformas de contabilidad y portales de distribuidores que la mayoría de las operaciones ya tienen. Los datos de ventas de tu POS alimentan los reportes de varianza del Costo Teórico de Alimentos.",
        bullets: [
          "Integración POS para reportes de varianza del Costo Teórico de Alimentos",
          "Exportación a QuickBooks para órdenes de compra recibidas",
          "Conexiones con portales de proveedores — Sysco, GFS, US Foods y distribuidores compatibles",
          "Acceso API para integraciones personalizadas (Operaciones Enterprise)",
          "Flujos de importación y exportación para operaciones aún no conectadas a portales",
        ],
        screenshot: "/screenshots/food-cost-variance.png",
        screenshotAlt: "Reporte de varianza de costos en FnB Cost Pro — real vs. teórico",
      },
    ],
    ctaTitle: "¿Listo para ver cómo funciona en tu operación?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos tu configuración actual, responderemos tus preguntas y confirmaremos si FnB Cost Pro es la opción correcta.",
    ctaButton: "Agendar una Revisión Culinaria",
  },

  forChefs: {
    meta: {
      title: "Para Chefs — FnB Cost Pro Plataforma de Operaciones Culinarias",
      description:
        "FnB Cost Pro está construido para equipos culinarios que trabajan con fotos, no con hojas de cálculo. Captura de recetas, costeo en vivo, sub-recetas y flujos de trabajo móviles.",
    },
    badge: "Para Chefs",
    headline: "La plataforma que trabaja como tú trabajas.",
    subheadline:
      "FnB Cost Pro está diseñado para que los equipos culinarios puedan capturar, costear y gestionar su trabajo sin tener que sentarse frente a una computadora.",
    ctaPrimary: "Agendar una Revisión Culinaria",
    sections: [
      {
        eyebrow: "Captura",
        headline: "Comienza con una foto de lo que ya tienes.",
        body: "Tarjetas de recetas escritas a mano. Menús impresos para el servicio. Facturas de la entrega de la mañana. FnB Cost Pro lee todo esto desde fotos — para que los datos existan en el sistema sin que el equipo tenga que volver a escribirlos.",
        bullets: [
          "Fotografía tarjetas de recetas escritas a mano — ingredientes extraídos automáticamente",
          "Escanea menús impresos — platos, secciones y precios capturados",
          "Las fotos de facturas capturan los precios entregados por línea",
          "Funciona con fotos, PDFs y exportaciones de hojas de cálculo existentes",
        ],
      },
      {
        eyebrow: "Especiales",
        headline: "Costea un nuevo especial en minutos.",
        body: "Cuando el especial de la noche cambia, el costo de la receta también debería cambiar. Fotografía la nueva tarjeta de receta, revisa los ingredientes extraídos, confirma la coincidencia con los precios actuales de proveedores y el costo está en vivo.",
        bullets: [
          "Nueva receta desde una foto en pocos toques",
          "Los ingredientes coinciden automáticamente con los precios actuales de proveedores",
          "El costo se recalcula cuando se confirma el especial",
          "Copia y adapta una receta existente como punto de partida",
        ],
      },
      {
        eyebrow: "Sub-Recetas",
        headline: "Preparaciones complejas costeadas correctamente.",
        body: "La mayoría de las herramientas de costeo de recetas aplanan las preparaciones en una lista de ingredientes crudos. FnB Cost Pro admite sub-recetas anidadas — un braseado, un fondo, una mantequilla compuesta, un curado — cada uno costeado como tal, con su propio rendimiento, usado como ingrediente en otras recetas.",
        bullets: [
          "Anida preparaciones como sub-recetas con su propio rendimiento",
          "Los costos de sub-recetas fluyen hacia cada receta principal que las usa",
          "Ajustes de rendimiento en cada nivel de anidamiento",
          "Las actualizaciones de costo se propagan en cascada cuando cambian los precios",
        ],
      },
      {
        eyebrow: "Costeo en Vivo",
        headline: "Costos de alimentos que se mantienen actuales sin actualizaciones manuales.",
        body: "Los costos de recetas en FnB Cost Pro se actualizan cuando cambian los precios de los proveedores — automáticamente, cuando se recibe la factura. Cada receta siempre muestra su costo actual.",
        bullets: [
          "Los costos unitarios se actualizan desde los precios de factura entregados",
          "El costo de receta se recalcula en cada plato que usa el ingrediente",
          "La comparación histórica de costos muestra cómo ha evolucionado el margen",
          "El recálculo de sub-recetas se propaga en el orden de dependencia correcto",
        ],
      },
      {
        eyebrow: "Móvil Primero",
        headline: "Construido para una cocina, no para un escritorio.",
        body: "Conteos de inventario, captura de facturas, fotografía de recetas — cada flujo de trabajo en FnB Cost Pro está diseñado para completarse en un teléfono o tablet desde el suelo de tu cocina. No se requiere laptop para tareas regulares.",
        bullets: [
          "Cuenta el inventario por escaneo de código de barras con tu teléfono",
          "Fotografía facturas en la recepción sin abandonar el muelle",
          "Tarjetas de recetas capturadas en la línea o en la preparación",
          "Compañero móvil para conteos, registro de desperdicios y recepción",
        ],
      },
      {
        eyebrow: "Gestión de Proveedores",
        headline: "Cambia un artículo de proveedor y mantén tus recetas intactas.",
        body: "Cuando un distribuidor descontinúa un SKU o cambias a un nuevo proveedor, FnB Cost Pro te permite volver a vincular ese ingrediente a un nuevo artículo sin reconstruir cada receta que lo usa.",
        bullets: [
          "Vuelve a vincular un artículo de inventario a un nuevo SKU de proveedor",
          "Todas las recetas que usan ese artículo se actualizan automáticamente",
          "El historial de precios rastrea el costo antes y después del cambio",
          "Múltiples fuentes de proveedores por artículo para comparación cruzada",
        ],
      },
      {
        eyebrow: "Menos Entrada",
        headline: "Captura una vez. La plataforma hace el resto.",
        body: "Cada escaneo, fotografía o carga reemplaza una tarea de entrada de datos. El objetivo no es eliminar el conocimiento operacional — es dejar de pedirle a los equipos culinarios que vuelvan a ingresar lo que ya saben.",
        bullets: [
          "El escaneo de menú alimenta la biblioteca de recetas automáticamente",
          "El escaneo de facturas actualiza los precios de proveedores sin entrada manual",
          "Importación de inventario desde hojas de conteo y hojas de cálculo existentes",
          "La captura basada en fotos funciona con los materiales que tu cocina ya tiene",
        ],
      },
    ],
    ctaTitle: "¿Quieres ver cómo funciona en tu cocina?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos tu configuración actual y confirmaremos si FnB Cost Pro es la opción correcta para tu cocina.",
    ctaButton: "Agendar una Revisión Culinaria",
  },

  forFbLeaders: {
    meta: {
      title: "Para Líderes de A&B — FnB Cost Pro Plataforma de Operaciones Culinarias",
      description:
        "Visibilidad multi-operación, inteligencia de precios de proveedores, costos de recetas estandarizados e información financiera — para directores de A&B, chefs ejecutivos y operadores multi-sucursal.",
    },
    badge: "Para Líderes de A&B",
    headline: "Inteligencia operacional para cada cocina que diriges.",
    subheadline:
      "FnB Cost Pro da a los directores de A&B, chefs ejecutivos y operadores multi-sucursal una visión clara de lo que cuesta cada operación — y hacia dónde se mueven los costos.",
    ctaPrimary: "Agendar una Revisión Culinaria",
    sections: [
      {
        eyebrow: "Multi-Operación",
        headline: "Cada sucursal en una sola vista.",
        body: "Una cuenta contiene cada operación. Los conteos por sucursal, los reportes de varianza y los costos de recetas son visibles desde la misma vista de gestión. Compara el rendimiento entre cocinas sin necesidad de hojas de cálculo.",
        bullets: [
          "Todas las operaciones bajo una sola cuenta",
          "Conteos de inventario y reportes de costos por sucursal",
          "Reportes de varianza entre sucursales",
          "Vista de gestión consolidada de dónde está cada cocina",
        ],
      },
      {
        eyebrow: "Estandarización",
        headline: "Una biblioteca de recetas. Cada cocina.",
        body: "Las bibliotecas de recetas centrales garantizan que cada cocina costee el mismo plato de la misma manera. Las actualizaciones a una receta compartida se propagan a todas las sucursales que la usan.",
        bullets: [
          "Biblioteca de recetas central compartida entre todas las sucursales",
          "Ajustes de rendimiento por sucursal donde varía la preparación",
          "Los cambios de receta se propagan automáticamente",
          "El costeo por sucursal refleja los precios reales de proveedores de cada cocina",
        ],
      },
      {
        eyebrow: "Precios de Proveedores",
        headline: "Precios específicos de cuenta de los distribuidores que usas.",
        body: "Captura precios de tus cuentas reales de distribuidores — no precios de catálogo, sino las tarifas negociadas que tu operación ha establecido. Las comparaciones entre guías muestran dónde los precios han cambiado en tus relaciones con proveedores.",
        bullets: [
          "Precios específicos de cuenta desde portales de distribuidores compatibles",
          "Importación de guías de pedidos de Sysco, GFS, US Foods y otros",
          "Comparación entre proveedores en todas las guías activas",
          "El historial de movimientos de precios muestra la tendencia de costos",
        ],
      },
      {
        eyebrow: "Compras Predictivas",
        headline: "Pedidos informados por el uso, no por el hábito.",
        body: "Los flujos de órdenes de compra se conectan al inventario y a los costos de recetas. A medida que se acumula el historial de compras, las sugerencias de cantidad de pedido se basan en patrones de uso reales.",
        bullets: [
          "Creación de órdenes de compra con flujo completo de recepción",
          "Recomendaciones de cantidad de pedido basadas en el historial de uso",
          "Niveles de reposición por sucursal y área de almacenamiento",
          "Las entregas recibidas actualizan el inventario y los costos de recetas automáticamente",
        ],
      },
      {
        eyebrow: "Inventario",
        headline: "Conteos que reflejan tu disposición real de almacenamiento.",
        body: "El inventario está organizado por ubicación física de almacenamiento — cámara frigorífica, almacén seco, congelador, bar. Los conteos se ingresan por ubicación para que el valor disponible sea preciso hasta donde cada artículo realmente se encuentra.",
        bullets: [
          "Gestión de ubicaciones de almacenamiento por cocina",
          "Conteos organizados por disposición física para conteo eficiente",
          "Escaneo de peso de captura para proteínas y artículos por peso",
          "Los datos históricos de conteo muestran la tendencia de disponibles a lo largo del tiempo",
        ],
      },
      {
        eyebrow: "Flujos de Revisión",
        headline: "Nada se guarda sin revisión del equipo.",
        body: "Cada extracción — receta, factura, inventario — pasa por un flujo de revisión antes de aplicarse al sistema. El equipo confirma la coincidencia y los precios antes de guardar cualquier cosa.",
        bullets: [
          "Ingredientes de recetas extraídos revisados antes de guardar",
          "Líneas de factura confirmadas antes de aplicar actualizaciones de precios",
          "Importaciones de inventario revisadas antes de cambiar los valores de conteo",
          "Acceso basado en roles para administración, gestión y personal de cocina",
        ],
      },
      {
        eyebrow: "Información Financiera",
        headline: "Lo que deberías haber gastado vs. lo que gastaste.",
        body: "El Costo Teórico de Alimentos muestra lo que la cocina debería haber gastado según las ventas POS y los costos de recetas. Compáralo con el gasto real para identificar desperdicios, exceso de porciones o merma — por categoría, por sucursal y en el tiempo.",
        bullets: [
          "Costo Teórico de Alimentos desde ventas POS × costos de recetas",
          "Comparación real vs. teórico por categoría",
          "Varianza por sucursal para comparaciones multi-operación",
          "Reportes de rango de fechas y análisis de tendencias",
          "Exportación a QuickBooks para conciliación contable",
        ],
      },
    ],
    ctaTitle: "¿Listo para ver cómo funciona en tus operaciones?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos tu configuración actual y confirmaremos si FnB Cost Pro es la opción correcta.",
    ctaButton: "Agendar una Revisión Culinaria",
  },

  industryChefLed: {
    meta: {
      title: "Restaurantes Liderados por Chefs — FnB Cost Pro",
      description:
        "FnB Cost Pro ayuda a los restaurantes liderados por chefs a capturar costos de recetas, rastrear precios de proveedores y gestionar inventario sin la carga administrativa. Flujos de trabajo foto-primero para equipos culinarios.",
    },
    badge: "Restaurantes Liderados por Chefs",
    headline: "Gestiona el back de house con la misma precisión que el frente.",
    subheadline:
      "Los restaurantes liderados por chefs viven de la calidad culinaria y los márgenes ajustados. FnB Cost Pro da a la cocina las herramientas operacionales para proteger ambos — sin agregar carga administrativa.",
    challenge: {
      eyebrow: "El Desafío",
      headline: "Precisión culinaria sin la carga de back-office.",
      body: "Los restaurantes liderados por chefs generalmente son operados por equipos culinarios con poco apoyo administrativo. La documentación de recetas, el rastreo de facturas de proveedores y la gestión de inventario recaen sobre las mismas personas que están cocinando.",
      bullets: [
        "Las recetas viven en tarjetas índice y en la mente de los chefs, no en ningún sistema",
        "Los precios de proveedores raramente están actualizados porque la entrada manual toma demasiado tiempo",
        "Los conteos de inventario dependen de portapapeles y hojas de cálculo que se desactualizan",
        "La visibilidad de costos de alimentos llega semanas después del hecho, si es que llega",
      ],
    },
    howItWorks: {
      eyebrow: "Cómo Funciona",
      headline: "Configuración foto-primero. Datos en vivo. Sin carga de entrada de datos.",
      body: "FnB Cost Pro convierte los materiales que la cocina ya tiene — tarjetas de recetas escritas a mano, menús impresos, facturas de proveedores — en un sistema de costos funcional. Los chefs fotografían en lugar de volver a escribir.",
      bullets: [
        "Fotografía tarjetas de recetas — ingredientes extraídos y costeados desde precios de proveedores",
        "El escaneo de facturas captura los precios entregados de cada entrega en recepción",
        "Importación de guías de pedidos de Sysco, GFS, US Foods y otros",
        "Conteos de inventario por teléfono — organizados por tu disposición de almacenamiento",
        "Los costos de recetas se actualizan automáticamente cuando cambian los precios de proveedores",
        "Sub-recetas y preparaciones anidadas con sus propios rendimientos",
      ],
    },
    screenshot: "/screenshots/recipe-card-phone-scene.png",
    screenshotAlt: "Capturando una tarjeta de receta escrita a mano con FnB Cost Pro",
    ctaTitle: "¿Listo para ver cómo funciona en tu cocina?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos tu operación actual y confirmaremos si FnB Cost Pro es la opción correcta — antes de que te comprometas con algo.",
    ctaButton: "Agendar una Revisión Culinaria",
  },

  industryGroups: {
    meta: {
      title: "Grupos de Restaurantes — FnB Cost Pro",
      description:
        "FnB Cost Pro ayuda a los grupos de restaurantes a estandarizar los costos de recetas, rastrear los precios de proveedores entre sucursales y comparar el rendimiento en cada cocina desde una cuenta.",
    },
    badge: "Grupos de Restaurantes",
    headline: "Costos consistentes en cada cocina.",
    subheadline:
      "Los grupos de restaurantes necesitan consistencia en recetas, visibilidad entre sucursales y precios de proveedores que reflejen cada operación. FnB Cost Pro está construido para esa escala.",
    challenge: {
      eyebrow: "El Desafío",
      headline: "La consistencia se pierde a medida que los grupos crecen.",
      body: "A medida que los grupos se expanden, la brecha entre cómo se costean las recetas en cada sucursal se amplía. Los precios de proveedores se negocian centralmente pero se rastrean localmente — o no se rastrean en absoluto.",
      bullets: [
        "Recetas costeadas de manera diferente en cada sucursal usando distintas suposiciones",
        "Sin visibilidad centralizada de precios de proveedores en todas las guías de pedidos",
        "Los reportes de varianza entre sucursales requieren exportación manual y comparación",
        "Los gerentes de cocina operando con diferente calidad de datos en cada sucursal",
      ],
    },
    howItWorks: {
      eyebrow: "Cómo Funciona",
      headline: "Una cuenta. Cada operación.",
      body: "FnB Cost Pro gestiona todas las operaciones bajo una sola cuenta. Las bibliotecas de recetas centrales garantizan costos consistentes. Los precios de proveedores por sucursal reflejan las guías de pedidos reales de cada operación. Los reportes de varianza entre sucursales muestran dónde está cada cocina.",
      bullets: [
        "Biblioteca de recetas central compartida entre todas las sucursales",
        "Gestión de precios de proveedores y guías de pedidos por sucursal",
        "Reportes de varianza y comparación de costos entre sucursales",
        "Órdenes de transferencia entre sucursales",
        "Acceso basado en roles — niveles regional, de gestión y de personal de cocina",
        "Una vista de todas las operaciones desde la cuenta de gestión",
      ],
    },
    screenshot: "/screenshots/multi-location.png",
    screenshotAlt: "Gestión multi-sucursal en FnB Cost Pro — visibilidad entre sucursales",
    ctaTitle: "¿Listo para ver cómo funciona en tu grupo?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos cómo FnB Cost Pro maneja tu configuración específica multi-sucursal — antes de que te comprometas con algo.",
    ctaButton: "Agendar una Revisión Culinaria",
  },

  industryClubs: {
    meta: {
      title: "Clubes y Resorts — FnB Cost Pro",
      description:
        "FnB Cost Pro apoya las operaciones de A&B multi-punto en clubes, resorts y hoteles — cada punto con su propio inventario, proveedores y biblioteca de recetas, todo visible desde una cuenta.",
    },
    badge: "Clubes y Resorts",
    headline: "Inteligencia de A&B para operaciones multi-punto complejas.",
    subheadline:
      "Los clubes y resorts operan múltiples puntos de A&B simultáneamente. FnB Cost Pro maneja esa complejidad sin requerir un sistema separado para cada punto.",
    challenge: {
      eyebrow: "El Desafío",
      headline: "Múltiples puntos. Múltiples sistemas. Sin una vista unificada.",
      body: "Los clubes y resorts a menudo operan varios puntos de A&B simultáneamente, cada uno con su propio menú, relaciones con proveedores y estructura de costos. Gestionar estos como hojas de cálculo separadas hace que los reportes de costos consistentes sean casi imposibles.",
      bullets: [
        "Múltiples puntos de A&B bajo una propiedad, cada uno gestionado por separado",
        "Producción de banquetes y eventos con cantidades de recetas variables por evento",
        "Diferentes relaciones con proveedores y precios negociados por punto",
        "Sin vista consolidada del rendimiento de costos en toda la propiedad",
      ],
    },
    howItWorks: {
      eyebrow: "Cómo Funciona",
      headline: "Una plataforma. Cada punto.",
      body: "El alcance de Operaciones Enterprise de FnB Cost Pro está diseñado para clubes, resorts y propiedades multi-punto. Todos los puntos se gestionan bajo una cuenta — cada uno con su propio inventario, precios de proveedores y biblioteca de recetas.",
      bullets: [
        "Gestión multi-punto bajo una sola cuenta",
        "Inventario, biblioteca de recetas y acceso de proveedores por punto",
        "Costeo de recetas de banquetes para producción de eventos de cantidad variable",
        "Reportes de varianza y comparación de costos entre puntos",
        "Configuración personalizada e implementación estructurada para configuraciones complejas",
        "Soporte con respaldo de SLA para operaciones enterprise",
      ],
    },
    screenshot: "/screenshots/multi-location.png",
    screenshotAlt: "Gestión multi-punto en FnB Cost Pro para clubes y resorts",
    ctaTitle: "¿Operas una operación de A&B compleja?",
    ctaSubtitle:
      "Conéctate con nuestro equipo. Revisaremos la estructura de A&B de tu propiedad y confirmaremos si el alcance Enterprise de FnB Cost Pro es la opción correcta.",
    ctaButton: "Agendar una Revisión Culinaria",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────

// @ts-ignore
export const newPageTranslations: Record<Language, typeof en> = { en, es };
